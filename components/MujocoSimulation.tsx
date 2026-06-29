"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Activity, AlertTriangle, Cpu, Pause, Play, RotateCcw } from "lucide-react";
import { Panel } from "@/components/ui/Panel";
import { loadMujocoModule, stageAndLoad, type MjDataHandle, type MjModelHandle, type MujocoModule } from "@/lib/mujoco/loader";
import { getModel, SIM_MODELS, type SimController, type SimModel, type TelemetryChannel } from "@/lib/mujoco/models";
import type { Incident, TimelineEvent } from "@/lib/types";

// MuJoCo geom type codes (this WASM build).
const PLANE = 0;
const SPHERE = 2;
const CAPSULE = 3;
const ELLIPSOID = 4;
const CYLINDER = 5;
const BOX = 6;
const MESH = 7;
// Geoms in collision/site groups (>= 3) are hidden — we render only visuals.
const MAX_VISIBLE_GROUP = 2;

// Scratch matrix reused across frames to avoid per-frame allocation.
const SCRATCH_M4 = new THREE.Matrix4();

/** Build a Three.js geometry for a primitive geom, baking in MuJoCo's local-Z
 *  axis convention (Three's capsule/cylinder default to local Y). */
function buildPrimitive(type: number, sx: number, sy: number, sz: number): THREE.BufferGeometry | null {
  switch (type) {
    case PLANE:
      return new THREE.PlaneGeometry(sx > 0 ? sx * 2 : 12, sy > 0 ? sy * 2 : 12);
    case SPHERE:
      return new THREE.SphereGeometry(sx, 24, 16);
    case CAPSULE: {
      const g = new THREE.CapsuleGeometry(sx, sy * 2, 8, 16);
      g.rotateX(Math.PI / 2);
      return g;
    }
    case ELLIPSOID: {
      const g = new THREE.SphereGeometry(1, 24, 16);
      g.scale(sx, sy, sz);
      return g;
    }
    case CYLINDER: {
      const g = new THREE.CylinderGeometry(sx, sx, sy * 2, 24);
      g.rotateX(Math.PI / 2);
      return g;
    }
    case BOX:
      return new THREE.BoxGeometry(sx * 2, sy * 2, sz * 2);
    default:
      return null;
  }
}

/** Build a Three.js geometry from a compiled MuJoCo mesh (vertices/normals/faces
 *  are sliced per-mesh; face indices are local 0-based within the mesh). */
function buildMesh(model: MjModelHandle, dataId: number): THREE.BufferGeometry {
  const va = model.mesh_vertadr[dataId];
  const vn = model.mesh_vertnum[dataId];
  const fa = model.mesh_faceadr[dataId];
  const fn = model.mesh_facenum[dataId];
  const positions = new Float32Array(vn * 3);
  const normals = new Float32Array(vn * 3);
  for (let i = 0; i < vn * 3; i++) {
    positions[i] = model.mesh_vert[va * 3 + i];
    normals[i] = model.mesh_normal[va * 3 + i];
  }
  const indices = new Uint32Array(fn * 3);
  for (let i = 0; i < fn * 3; i++) indices[i] = model.mesh_face[fa * 3 + i];
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  g.setIndex(new THREE.BufferAttribute(indices, 1));
  return g;
}

/** Resolve a geom's display colour from its material, falling back to geom_rgba. */
function geomColor(model: MjModelHandle, i: number): { color: THREE.Color; opacity: number } {
  const mid = model.geom_matid[i];
  const src = mid >= 0 ? { arr: model.mat_rgba, off: mid * 4 } : { arr: model.geom_rgba, off: i * 4 };
  return {
    color: new THREE.Color(src.arr[src.off], src.arr[src.off + 1], src.arr[src.off + 2]),
    opacity: src.arr[src.off + 3],
  };
}

type Status = "loading" | "ready" | "error";
type Chip = { label: string; value: string; warn?: boolean };

interface SceneRefs {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  group: THREE.Group;
  meshes: { mesh: THREE.Mesh; geomIndex: number }[];
  raf: number;
}

interface SimRefs {
  mod: MujocoModule | null;
  model: MjModelHandle | null;
  data: MjDataHandle | null;
}

export interface MujocoSimulationProps {
  /** The incident in focus — used as the base when capturing twin evidence. */
  incident?: Incident;
  /** Fold a fault reproduced in the twin back into the investigation. */
  onEvidenceChange?: (next: Incident) => void;
  /** Start the war-room analysis once twin evidence has been captured. */
  onRunInvestigation?: () => void | Promise<void>;
}

export function MujocoSimulation({ incident, onEvidenceChange, onRunInvestigation }: MujocoSimulationProps = {}) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<SceneRefs | null>(null);
  const simRef = useRef<SimRefs>({ mod: null, model: null, data: null });
  const controllerRef = useRef<SimController | null>(null);

  const runningRef = useRef(true);
  const metaRef = useRef<SimModel>(getModel(SIM_MODELS[0].id));
  const prevModelIdRef = useRef<string | null>(null);
  const buildIdRef = useRef(0);
  const frameRef = useRef(0);
  // Mirror state into refs so the async build and rAF loop read fresh values.
  const failuresRef = useRef<string[]>([]);
  const ctrlRef = useRef<number[]>(SIM_MODELS[0].controls.map((c) => c.default));

  const [status, setStatus] = useState<Status>("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState(SIM_MODELS[0].id);
  const [isRunning, setIsRunning] = useState(true);
  const [activeFailures, setActiveFailures] = useState<string[]>([]);
  const [ctrlValues, setCtrlValues] = useState<number[]>(SIM_MODELS[0].controls.map((c) => c.default));
  const [telemetry, setTelemetry] = useState<number[]>([]);
  const [chips, setChips] = useState<Chip[]>([]);
  const [simTime, setSimTime] = useState(0);
  const [captured, setCaptured] = useState(false);

  const model = getModel(selectedId);
  metaRef.current = model;
  const hasCapturedEvidence = Boolean(incident?.logs.trim() || incident?.timestampedEvents.length);

  const ctx = useCallback(() => {
    const { mod, model: m, data: d } = simRef.current;
    return mod && m && d ? { mod, model: m, data: d } : null;
  }, []);

  // ── (Re)build model + meshes (async: stages mesh assets on first use) ──────
  const buildModel = useCallback(
    async (modelDef: SimModel, failures: string[], resetControls: boolean) => {
      const mod = simRef.current.mod;
      const sc = sceneRef.current;
      if (!mod || !sc) return;
      const myBuild = ++buildIdRef.current;
      setStatus("loading");

      try {
        const m = await stageAndLoad(mod, modelDef.assets);
        if (myBuild !== buildIdRef.current) {
          m.delete();
          return; // a newer build superseded this one
        }
        for (const f of modelDef.failures) {
          if (f.apply && failures.includes(f.id)) f.apply(m);
        }

        const d = new mod.MjData(m);
        modelDef.homeQpos.forEach((v, i) => (d.qpos[i] = v));
        const applied = resetControls ? modelDef.controls.map((c) => c.default) : ctrlRef.current;
        modelDef.controls.forEach((c, ci) => {
          if (c.indices) for (const idx of c.indices) d.ctrl[idx] = applied[ci];
        });
        mod.mj_forward(m, d);

        simRef.current.data?.delete();
        simRef.current.model?.delete();
        simRef.current.model = m;
        simRef.current.data = d;

        // Controller (scripted cells) — seed flags + control params.
        if (modelDef.makeController) {
          const c = modelDef.makeController();
          c.flags = new Set(failures.filter((id) => modelDef.failures.find((f) => f.id === id)?.controllerFlag));
          c.reset({ mod, model: m, data: d });
          modelDef.controls.forEach((ct, ci) => {
            if (ct.param) c.setParam(ct.param, applied[ci]);
          });
          controllerRef.current = c;
        } else {
          controllerRef.current = null;
        }

        rebuildMeshes(sc, m);
        if (prevModelIdRef.current !== modelDef.id) {
          frameCamera(sc, modelDef.camera);
          prevModelIdRef.current = modelDef.id;
        }
        paintFrame(sc, d);

        ctrlRef.current = applied;
        if (resetControls) setCtrlValues(applied);
        frameRef.current = 0;
        setErrorMsg(null);
        setStatus("ready");
      } catch (err) {
        if (myBuild === buildIdRef.current) {
          setErrorMsg(err instanceof Error ? err.message : "Failed to load the simulation.");
          setStatus("error");
        }
      }
    },
    [],
  );

  // ── One-time Three.js scene + animation loop ─────────────────────────────
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const width = mount.clientWidth || 800;
    const height = mount.clientHeight || 460;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";
    renderer.domElement.style.borderRadius = "10px";

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.03, 100);
    camera.up.set(0, 0, 1); // MuJoCo is Z-up.
    camera.position.set(2, 2, 1.5);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 0.4;
    controls.maxDistance = 14;

    const hemi = new THREE.HemisphereLight(0xffffff, 0x9aa3b2, 0.85);
    scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 1.0);
    key.position.set(2.5, 2, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 20;
    const sc = key.shadow.camera as THREE.OrthographicCamera;
    sc.left = -3;
    sc.right = 3;
    sc.top = 3;
    sc.bottom = -3;
    scene.add(key);

    const grid = new THREE.GridHelper(12, 48, 0xcbd5e1, 0xe2e8f0);
    grid.rotateX(Math.PI / 2);
    grid.position.z = 0.001;
    scene.add(grid);

    const group = new THREE.Group();
    scene.add(group);

    const refs: SceneRefs = { renderer, scene, camera, controls, group, meshes: [], raf: 0 };
    sceneRef.current = refs;

    const animate = () => {
      refs.raf = requestAnimationFrame(animate);
      const c = simRef.current.mod && simRef.current.model && simRef.current.data;
      const meta = metaRef.current;

      if (c && runningRef.current) {
        const { mod, model: m, data: d } = simRef.current;
        const controller = controllerRef.current;
        for (let s = 0; s < meta.realtimeSteps; s++) {
          if (controller) controller.step({ mod: mod!, model: m!, data: d! });
          else mod!.mj_step(m!, d!);
        }
      }

      if (simRef.current.model && simRef.current.data) {
        applyTransforms(refs, simRef.current.data);
        if (frameRef.current % 4 === 0) pushReadouts(meta);
        frameRef.current++;
      }

      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const ro = new ResizeObserver(() => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if (!w || !h) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    ro.observe(mount);

    return () => {
      cancelAnimationFrame(refs.raf);
      ro.disconnect();
      simRef.current.data?.delete();
      simRef.current.model?.delete();
      simRef.current.data = null;
      simRef.current.model = null;
      for (const { mesh } of refs.meshes) {
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      }
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
      sceneRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Load WASM once, then build the initial model ─────────────────────────
  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    loadMujocoModule()
      .then((mod) => {
        if (cancelled) return;
        simRef.current.mod = mod;
        prevModelIdRef.current = null;
        return buildModel(metaRef.current, [], true);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setErrorMsg(err instanceof Error ? err.message : "Failed to load the MuJoCo runtime.");
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [buildModel]);

  // ── Rebuild on model change ──────────────────────────────────────────────
  useEffect(() => {
    if (!simRef.current.mod) return;
    failuresRef.current = [];
    setActiveFailures([]);
    buildModel(getModel(selectedId), [], true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // ── Per-frame helpers (defined inline to close over refs) ────────────────
  function rebuildMeshes(sc: SceneRefs, m: MjModelHandle) {
    for (const { mesh } of sc.meshes) {
      sc.group.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    sc.meshes = [];
    for (let i = 0; i < m.ngeom; i++) {
      if (m.geom_group[i] > MAX_VISIBLE_GROUP) continue; // hide collision geoms
      const type = m.geom_type[i];
      const geometry =
        type === MESH ? buildMesh(m, m.geom_dataid[i]) : buildPrimitive(type, m.geom_size[i * 3], m.geom_size[i * 3 + 1], m.geom_size[i * 3 + 2]);
      if (!geometry) continue;
      const { color, opacity } = geomColor(m, i);
      const isFloor = type === PLANE;
      const material = new THREE.MeshStandardMaterial({
        color,
        metalness: isFloor ? 0 : 0.2,
        roughness: isFloor ? 0.95 : 0.6,
        transparent: opacity < 1,
        opacity,
        side: opacity < 1 ? THREE.DoubleSide : THREE.FrontSide,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.matrixAutoUpdate = false;
      mesh.castShadow = !isFloor && opacity >= 1;
      mesh.receiveShadow = true;
      sc.group.add(mesh);
      sc.meshes.push({ mesh, geomIndex: i });
    }
  }

  function applyTransforms(sc: SceneRefs, d: MjDataHandle) {
    const m4 = SCRATCH_M4;
    for (const { mesh, geomIndex } of sc.meshes) {
      const xm = geomIndex * 9;
      const xp = geomIndex * 3;
      m4.set(
        d.geom_xmat[xm + 0], d.geom_xmat[xm + 1], d.geom_xmat[xm + 2], d.geom_xpos[xp + 0],
        d.geom_xmat[xm + 3], d.geom_xmat[xm + 4], d.geom_xmat[xm + 5], d.geom_xpos[xp + 1],
        d.geom_xmat[xm + 6], d.geom_xmat[xm + 7], d.geom_xmat[xm + 8], d.geom_xpos[xp + 2],
        0, 0, 0, 1,
      );
      mesh.matrix.copy(m4);
    }
  }

  function paintFrame(sc: SceneRefs, d: MjDataHandle) {
    applyTransforms(sc, d);
    sc.renderer.render(sc.scene, sc.camera);
  }

  function frameCamera(sc: SceneRefs, cam: SimModel["camera"]) {
    const t = new THREE.Vector3(cam.target[0], cam.target[1], cam.target[2]);
    sc.camera.position.set(
      t.x + cam.distance * Math.cos(cam.elevation) * Math.cos(cam.azimuth),
      t.y + cam.distance * Math.cos(cam.elevation) * Math.sin(cam.azimuth),
      t.z + cam.distance * Math.sin(cam.elevation),
    );
    sc.controls.target.copy(t);
    sc.controls.update();
  }

  function readChannel(ch: TelemetryChannel, d: MjDataHandle, controllerTelemetry: Record<string, number>): number {
    switch (ch.source) {
      case "qpos":
        return Number(d.qpos[ch.index ?? 0]) * (ch.scale ?? 1);
      case "qvel":
        return Number(d.qvel[ch.index ?? 0]) * (ch.scale ?? 1);
      case "actuator_force":
        return Number(d.actuator_force[ch.index ?? 0]) * (ch.scale ?? 1);
      case "site":
        return Number(d.site_xpos[(ch.index ?? 0) * 3 + (ch.axis ?? 0)]) * (ch.scale ?? 1);
      case "controller":
        return (controllerTelemetry[ch.key ?? ""] ?? 0) * (ch.scale ?? 1);
    }
  }

  function pushReadouts(meta: SimModel) {
    const c = ctx();
    if (!c) return;
    const controller = controllerRef.current;
    const ctel = controller ? controller.telemetry(c) : {};
    setTelemetry(meta.telemetry.map((ch) => readChannel(ch, c.data, ctel)));
    setChips(controller ? controller.status(c) : []);
    setSimTime(c.data.time);
  }

  // ── UI actions ───────────────────────────────────────────────────────────
  function toggleFailure(id: string) {
    const next = activeFailures.includes(id) ? activeFailures.filter((f) => f !== id) : [...activeFailures, id];
    setActiveFailures(next);
    failuresRef.current = next;
    const failure = model.failures.find((f) => f.id === id);
    if (failure?.controllerFlag && controllerRef.current) {
      // Live toggle — no rebuild needed.
      controllerRef.current.flags = new Set(next.filter((fid) => model.failures.find((f) => f.id === fid)?.controllerFlag));
    } else {
      buildModel(model, next, false); // model-mutation fault → rebuild
    }
  }

  function handleReset() {
    buildModel(model, failuresRef.current, true);
  }

  function toggleRun() {
    runningRef.current = !runningRef.current;
    setIsRunning(runningRef.current);
  }

  /** Fold the currently-reproduced fault(s) + out-of-spec telemetry into a new
   *  incident, so the war-room agents can investigate what the twin just showed. */
  function captureEvidence() {
    const c = ctx();
    if (!onEvidenceChange || !incident || !c) return;
    const meta = metaRef.current;
    const faults = meta.failures.filter((f) => activeFailures.includes(f.id));
    if (!faults.length) return;

    const ctel = controllerRef.current ? controllerRef.current.telemetry(c) : {};
    const stamp = new Date().toTimeString().slice(0, 8);
    const outOfSpec = meta.telemetry
      .map((ch) => ({ ch, v: readChannel(ch, c.data, ctel) }))
      .filter(({ ch, v }) => ch.nominal && (v < ch.nominal[0] || v > ch.nominal[1]));

    const faultLines = faults.map((f) => `${stamp} TWIN robot="${meta.robot}" fault="${f.label}"`);
    const obsLines = outOfSpec.map(
      ({ ch, v }) => `${stamp} TWIN ${ch.label.replace(/[^A-Za-z0-9]+/g, "_")}=${v.toFixed(2)}${ch.unit} OUT_OF_SPEC`,
    );
    const safetyBreach = faults.some((f) => f.id === "overreach");
    const notes = faults.map((f) => `Digital-twin reproduction on ${meta.robot}: ${f.label} — ${f.description}`).join("\n");
    const event: TimelineEvent = {
      timestamp: stamp,
      event: `Digital twin reproduced ${faults.map((f) => f.label).join(", ")}`,
      source: meta.robot,
      severity: safetyBreach ? "critical" : "warning",
    };

    onEvidenceChange({
      ...incident,
      incidentTitle: `${meta.label}: ${faults[0].label}`,
      machineType: meta.robot,
      severity: safetyBreach ? "critical" : incident.severity === "low" ? "medium" : incident.severity,
      logs: [incident.logs.trim(), ...faultLines, ...obsLines].filter(Boolean).join("\n"),
      maintenanceNotes: [incident.maintenanceNotes.trim(), notes].filter(Boolean).join("\n"),
      timestampedEvents: [...incident.timestampedEvents, event],
    });
    setCaptured(true);
    window.setTimeout(() => setCaptured(false), 2200);
  }

  function setControl(ci: number, value: number) {
    const next = [...ctrlValues];
    next[ci] = value;
    setCtrlValues(next);
    ctrlRef.current = next;
    const control = model.controls[ci];
    if (control.param) controllerRef.current?.setParam(control.param, value);
    else if (control.indices && simRef.current.data) {
      for (const idx of control.indices) simRef.current.data.ctrl[idx] = value;
    }
  }

  return (
    <Panel
      title="Live physics simulation"
      subtitle="Real industrial robots (MuJoCo Menagerie), compiled to WebAssembly — stepping in your browser."
      icon={<Cpu className="h-4 w-4" />}
      accent="brand"
      bodyClassName="p-0"
      trailing={
        <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-label text-emerald-700">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          WASM physics
        </span>
      }
    >
      {SIM_MODELS.length > 1 ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-3">
          {SIM_MODELS.map((m) => {
            const active = m.id === selectedId;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setSelectedId(m.id)}
                className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors ${
                  active ? "bg-brand-600 text-white shadow-sm" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                {m.label}
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="flex flex-wrap items-baseline gap-x-2 px-5 pt-4">
        <span className="text-[11px] font-semibold uppercase tracking-label text-brand-600">{model.robot}</span>
      </div>
      <p className="px-5 pt-1 text-[13px] leading-6 text-slate-500">{model.description}</p>

      <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white">
            <div ref={mountRef} className="h-[320px] w-full sm:h-[460px]" />

            {status !== "ready" ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-white/70 backdrop-blur-sm">
                {status === "loading" ? (
                  <>
                    <span className="h-7 w-7 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
                    <p className="text-[13px] font-medium text-slate-600">Loading robot & physics engine…</p>
                    <p className="text-xs text-slate-400">MuJoCo WASM + validated robot meshes</p>
                  </>
                ) : (
                  <div className="flex max-w-sm items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-800">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                    <div>
                      <p className="font-medium">Simulation unavailable</p>
                      <p className="mt-0.5 text-red-700">{errorMsg}</p>
                    </div>
                  </div>
                )}
              </div>
            ) : null}

            <div className="absolute bottom-3 left-3 flex items-center gap-2">
              <button
                type="button"
                onClick={toggleRun}
                disabled={status !== "ready"}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900/85 px-3 py-1.5 text-xs font-medium text-white shadow-sm backdrop-blur transition-colors hover:bg-slate-900 disabled:opacity-40"
              >
                {isRunning ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                {isRunning ? "Pause" : "Run"}
              </button>
              <button
                type="button"
                onClick={handleReset}
                disabled={status !== "ready"}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white/85 px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm ring-1 ring-slate-200 backdrop-blur transition-colors hover:bg-white disabled:opacity-40"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset
              </button>
            </div>

            <div className="absolute bottom-3 right-3 rounded-lg bg-white/85 px-2.5 py-1.5 font-mono text-[11px] tabular-nums text-slate-600 shadow-sm ring-1 ring-slate-200 backdrop-blur">
              t = {simTime.toFixed(2)}s
            </div>
            <div className="pointer-events-none absolute left-3 top-3 rounded-lg bg-white/80 px-2.5 py-1 text-[10px] font-medium uppercase tracking-label text-slate-500 shadow-sm ring-1 ring-slate-200 backdrop-blur">
              {model.tagline}
            </div>

            {chips.length ? (
              <div className="pointer-events-none absolute right-3 top-3 flex flex-col items-end gap-1">
                {chips.map((chip) => (
                  <span
                    key={chip.label}
                    className={`rounded-md px-2 py-0.5 text-[10px] font-medium shadow-sm ring-1 backdrop-blur ${
                      chip.warn ? "bg-red-50/90 text-red-700 ring-red-200" : "bg-white/85 text-slate-600 ring-slate-200"
                    }`}
                  >
                    {chip.label}: <span className="font-mono tabular-nums">{chip.value}</span>
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          <div className="mt-4 space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-label text-slate-400">
              {model.controls.some((c) => c.param) ? "Process controls" : "Joint commands"}
            </p>
            {model.controls.map((c, ci) => (
              <div key={c.label}>
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-600">{c.label}</span>
                  <span className="font-mono tabular-nums text-slate-500">
                    {ctrlValues[ci]?.toFixed(c.step < 0.01 ? 3 : 2)} {c.unit}
                  </span>
                </div>
                <input
                  type="range"
                  min={c.min}
                  max={c.max}
                  step={c.step}
                  value={ctrlValues[ci] ?? c.default}
                  onChange={(e) => setControl(ci, Number(e.target.value))}
                  disabled={status !== "ready"}
                  className="mt-1.5 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-brand-600 disabled:opacity-40"
                />
              </div>
            ))}
          </div>
        </div>

        <div className="min-w-0 space-y-4">
          <div>
            <div className="mb-2 flex items-center gap-1.5">
              <Activity className="h-3.5 w-3.5 text-brand-600" />
              <p className="text-[11px] font-semibold uppercase tracking-label text-slate-400">Live state</p>
            </div>
            <div className="space-y-1.5">
              {model.telemetry.map((t, i) => {
                const value = telemetry[i] ?? 0;
                const outOfSpec = t.nominal ? value < t.nominal[0] || value > t.nominal[1] : false;
                return (
                  <div
                    key={t.label}
                    className={`flex items-center justify-between rounded-lg border px-3 py-2 ${
                      outOfSpec ? "border-red-200 bg-red-50/70" : "border-slate-200 bg-slate-50/60"
                    }`}
                  >
                    <span className="text-xs text-slate-600">{t.label}</span>
                    <span className={`font-mono text-[13px] font-medium tabular-nums ${outOfSpec ? "text-red-600" : "text-slate-900"}`}>
                      {value.toFixed(2)}
                      {t.unit ? <span className="ml-1 text-[10px] font-normal text-slate-400">{t.unit}</span> : null}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
              <p className="text-[11px] font-semibold uppercase tracking-label text-slate-400">Inject failure</p>
            </div>
            <div className="space-y-2">
              {model.failures.map((f) => {
                const on = activeFailures.includes(f.id);
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => toggleFailure(f.id)}
                    disabled={status !== "ready"}
                    className={`w-full rounded-lg border px-3 py-2.5 text-left transition-colors disabled:opacity-40 ${
                      on ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={`text-[13px] font-medium ${on ? "text-amber-800" : "text-slate-700"}`}>{f.label}</span>
                      <span className={`flex h-4 w-7 shrink-0 items-center rounded-full px-0.5 transition-colors ${on ? "bg-amber-500" : "bg-slate-300"}`}>
                        <span className={`h-3 w-3 rounded-full bg-white transition-transform ${on ? "translate-x-3" : ""}`} />
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] leading-4 text-slate-500">{f.description}</p>
                  </button>
                );
              })}
            </div>

            {onEvidenceChange ? (
              <div className="mt-3 space-y-2">
                <button
                  type="button"
                  onClick={captureEvidence}
                  disabled={status !== "ready" || !activeFailures.length}
                  className="w-full rounded-lg bg-brand-600 px-3 py-2 text-[13px] font-medium text-white shadow-sm transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
                  title={activeFailures.length ? "Send this reproduced fault into the investigation" : "Inject a fault first"}
                >
                  {captured ? "Captured to incident evidence" : "Capture to incident evidence"}
                </button>
                {onRunInvestigation ? (
                  <button
                    type="button"
                    onClick={() => void onRunInvestigation()}
                    disabled={status !== "ready" || !hasCapturedEvidence}
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                    title={hasCapturedEvidence ? "Run the investigation" : "Capture evidence first"}
                  >
                    <Play className="h-3.5 w-3.5" />
                    Run investigation
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </Panel>
  );
}

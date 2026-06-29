"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Activity, AlertTriangle, Cpu, Pause, Play, RotateCcw, SlidersHorizontal } from "lucide-react";
import { loadMujocoModule, type MjDataHandle, type MjModelHandle, type MujocoModule } from "@/lib/mujoco/loader";
import { getModel, SIM_MODELS, type SimModel } from "@/lib/mujoco/models";

// MuJoCo geom type codes (this WASM build).
const PLANE = 0;
const SPHERE = 2;
const CAPSULE = 3;
const ELLIPSOID = 4;
const CYLINDER = 5;
const BOX = 6;

/** Build a Three.js geometry for a MuJoCo geom, baking in MuJoCo's local-Z
 *  axis convention (Three's capsule/cylinder default to local Y). */
function buildGeometry(type: number, sx: number, sy: number, sz: number): THREE.BufferGeometry | null {
  switch (type) {
    case PLANE:
      return new THREE.PlaneGeometry(sx > 0 ? sx * 2 : 10, sy > 0 ? sy * 2 : 10);
    case SPHERE:
      return new THREE.SphereGeometry(sx, 28, 18);
    case CAPSULE: {
      const g = new THREE.CapsuleGeometry(sx, sy * 2, 10, 20);
      g.rotateX(Math.PI / 2);
      return g;
    }
    case ELLIPSOID: {
      const g = new THREE.SphereGeometry(1, 28, 18);
      g.scale(sx, sy, sz);
      return g;
    }
    case CYLINDER: {
      const g = new THREE.CylinderGeometry(sx, sx, sy * 2, 28);
      g.rotateX(Math.PI / 2);
      return g;
    }
    case BOX:
      return new THREE.BoxGeometry(sx * 2, sy * 2, sz * 2);
    default:
      return null;
  }
}

type Status = "loading" | "ready" | "error";

interface SceneRefs {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  group: THREE.Group;
  meshes: THREE.Mesh[];
  raf: number;
  resizeObserver?: ResizeObserver;
}

interface SimRefs {
  mod: MujocoModule | null;
  model: MjModelHandle | null;
  data: MjDataHandle | null;
}

export function MujocoSimulation() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<SceneRefs | null>(null);
  const simRef = useRef<SimRefs>({ mod: null, model: null, data: null });

  // Mutable values the rAF loop reads without re-binding its closure.
  const runningRef = useRef(true);
  const metaRef = useRef<SimModel>(getModel(SIM_MODELS[0].id));
  const prevModelIdRef = useRef<string | null>(null);
  const frameRef = useRef(0);

  const [status, setStatus] = useState<Status>("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState(SIM_MODELS[0].id);
  const [isRunning, setIsRunning] = useState(true);
  const [activeFailures, setActiveFailures] = useState<string[]>([]);
  const [ctrlValues, setCtrlValues] = useState<number[]>(SIM_MODELS[0].controls.map((c) => c.default));
  const [telemetry, setTelemetry] = useState<number[]>([]);
  const [simTime, setSimTime] = useState(0);

  const model = getModel(selectedId);
  metaRef.current = model;

  // ── (Re)build the MuJoCo model/data and the Three.js meshes ──────────────
  const rebuild = useCallback(
    (modelDef: SimModel, failures: string[], resetControls: boolean, controlsToApply: number[]) => {
      const mod = simRef.current.mod;
      const sc = sceneRef.current;
      if (!mod || !sc) return;

      // Free the previous handles before allocating new ones.
      simRef.current.data?.delete();
      simRef.current.model?.delete();

      mod.FS.writeFile(`/${modelDef.id}.xml`, modelDef.xml);
      const m = mod.MjModel.loadFromXML(`/${modelDef.id}.xml`);
      if (!m) throw new Error(`Failed to compile model "${modelDef.label}".`);

      for (const f of modelDef.failures) {
        if (failures.includes(f.id)) f.apply(m);
      }

      const d = new mod.MjData(m);
      if (modelDef.initialQpos) {
        modelDef.initialQpos.forEach((v, i) => (d.qpos[i] = v));
        mod.mj_forward(m, d);
      }
      const applied = resetControls ? modelDef.controls.map((c) => c.default) : controlsToApply;
      modelDef.controls.forEach((c, ci) => {
        for (const idx of c.indices) d.ctrl[idx] = applied[ci];
      });
      // Compute kinematics so geom_xpos/xmat are valid for the first paint.
      mod.mj_forward(m, d);

      simRef.current.model = m;
      simRef.current.data = d;

      // Rebuild meshes from the model's geoms.
      for (const mesh of sc.meshes) {
        sc.group.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      }
      sc.meshes = [];
      for (let i = 0; i < m.ngeom; i++) {
        const type = m.geom_type[i];
        const geom = buildGeometry(type, m.geom_size[i * 3], m.geom_size[i * 3 + 1], m.geom_size[i * 3 + 2]);
        if (!geom) continue;
        const r = m.geom_rgba[i * 4];
        const g = m.geom_rgba[i * 4 + 1];
        const b = m.geom_rgba[i * 4 + 2];
        const a = m.geom_rgba[i * 4 + 3];
        const isFloor = type === PLANE;
        const material = new THREE.MeshStandardMaterial({
          color: new THREE.Color(r, g, b),
          metalness: isFloor ? 0 : 0.15,
          roughness: isFloor ? 0.95 : 0.55,
          transparent: a < 1,
          opacity: a,
        });
        const mesh = new THREE.Mesh(geom, material);
        mesh.matrixAutoUpdate = false;
        mesh.castShadow = !isFloor;
        mesh.receiveShadow = true;
        sc.group.add(mesh);
        sc.meshes.push(mesh);
      }

      // Frame the camera only when the model itself changes.
      if (prevModelIdRef.current !== modelDef.id) {
        const { distance, azimuth, elevation, target } = modelDef.camera;
        const t = new THREE.Vector3(target[0], target[1], target[2]);
        sc.camera.position.set(
          t.x + distance * Math.cos(elevation) * Math.cos(azimuth),
          t.y + distance * Math.cos(elevation) * Math.sin(azimuth),
          t.z + distance * Math.sin(elevation),
        );
        sc.controls.target.copy(t);
        sc.controls.update();
        prevModelIdRef.current = modelDef.id;
      }

      // Paint one frame immediately so the new model shows even before the
      // animation loop's next tick (e.g. while paused, or if rAF is throttled).
      const m4 = new THREE.Matrix4();
      for (let i = 0; i < sc.meshes.length; i++) {
        const xm = i * 9;
        const xp = i * 3;
        m4.set(
          d.geom_xmat[xm + 0], d.geom_xmat[xm + 1], d.geom_xmat[xm + 2], d.geom_xpos[xp + 0],
          d.geom_xmat[xm + 3], d.geom_xmat[xm + 4], d.geom_xmat[xm + 5], d.geom_xpos[xp + 1],
          d.geom_xmat[xm + 6], d.geom_xmat[xm + 7], d.geom_xmat[xm + 8], d.geom_xpos[xp + 2],
          0, 0, 0, 1,
        );
        sc.meshes[i].matrix.copy(m4);
      }
      sc.renderer.render(sc.scene, sc.camera);

      if (resetControls) setCtrlValues(applied);
      frameRef.current = 0;
    },
    [],
  );

  // ── One-time Three.js scene + animation loop ─────────────────────────────
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const width = mount.clientWidth || 800;
    const height = mount.clientHeight || 460;

    // preserveDrawingBuffer keeps the last frame readable for screenshots and
    // screen recordings (handy for demos) at negligible cost for these scenes.
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";
    renderer.domElement.style.borderRadius = "0";

    const scene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.05, 100);
    camera.up.set(0, 0, 1); // MuJoCo is Z-up.
    camera.position.set(2, 2, 1.5);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 0.4;
    controls.maxDistance = 12;

    // Lighting tuned to read as a clean engineering viewport.
    const hemi = new THREE.HemisphereLight(0xffffff, 0x9aa3b2, 0.85);
    scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(2.5, 2, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 20;
    (key.shadow.camera as THREE.OrthographicCamera).left = -4;
    (key.shadow.camera as THREE.OrthographicCamera).right = 4;
    (key.shadow.camera as THREE.OrthographicCamera).top = 4;
    (key.shadow.camera as THREE.OrthographicCamera).bottom = -4;
    scene.add(key);

    // Ground grid in the XY plane (MuJoCo floor plane).
    const grid = new THREE.GridHelper(12, 48, 0xcbd5e1, 0xe2e8f0);
    grid.rotateX(Math.PI / 2);
    grid.position.z = 0.001;
    scene.add(grid);

    const group = new THREE.Group();
    scene.add(group);

    const refs: SceneRefs = { renderer, scene, camera, controls, group, meshes: [], raf: 0 };
    sceneRef.current = refs;

    const m4 = new THREE.Matrix4();
    const animate = () => {
      refs.raf = requestAnimationFrame(animate);
      const { mod, model: m, data: d } = simRef.current;
      const meta = metaRef.current;

      if (mod && m && d && runningRef.current) {
        for (let s = 0; s < meta.realtimeSteps; s++) mod.mj_step(m, d);
      }

      if (m && d) {
        for (let i = 0; i < refs.meshes.length; i++) {
          const xm = i * 9;
          const xp = i * 3;
          m4.set(
            d.geom_xmat[xm + 0], d.geom_xmat[xm + 1], d.geom_xmat[xm + 2], d.geom_xpos[xp + 0],
            d.geom_xmat[xm + 3], d.geom_xmat[xm + 4], d.geom_xmat[xm + 5], d.geom_xpos[xp + 1],
            d.geom_xmat[xm + 6], d.geom_xmat[xm + 7], d.geom_xmat[xm + 8], d.geom_xpos[xp + 2],
            0, 0, 0, 1,
          );
          refs.meshes[i].matrix.copy(m4);
        }

        // Stream telemetry to React at ~15 Hz to keep the readouts legible.
        if (frameRef.current % 4 === 0) {
          const values = meta.telemetry.map((t) => {
            if (t.source === "time") return d.time;
            const arr = t.source === "qpos" ? d.qpos : t.source === "qvel" ? d.qvel : d.actuator_force;
            return Number(arr[t.index]) * (t.scale ?? 1);
          });
          setTelemetry(values);
          setSimTime(d.time);
        }
        frameRef.current++;
      }

      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const resizeObserver = new ResizeObserver(() => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if (w === 0 || h === 0) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    resizeObserver.observe(mount);
    refs.resizeObserver = resizeObserver;

    return () => {
      cancelAnimationFrame(refs.raf);
      resizeObserver.disconnect();
      simRef.current.data?.delete();
      simRef.current.model?.delete();
      simRef.current.data = null;
      simRef.current.model = null;
      for (const mesh of refs.meshes) {
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      }
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
      sceneRef.current = null;
    };
  }, []);

  // ── Load the WASM module once ────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    loadMujocoModule()
      .then((mod) => {
        if (cancelled) return;
        simRef.current.mod = mod;
        prevModelIdRef.current = null;
        rebuild(metaRef.current, [], true, []);
        setStatus("ready");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setErrorMsg(err instanceof Error ? err.message : "Failed to load the MuJoCo runtime.");
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [rebuild]);

  // ── Rebuild on model change ──────────────────────────────────────────────
  useEffect(() => {
    if (status !== "ready") return;
    try {
      rebuild(getModel(selectedId), [], true, []);
      setActiveFailures([]);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Simulation rebuild failed.");
      setStatus("error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  function toggleFailure(id: string) {
    const next = activeFailures.includes(id) ? activeFailures.filter((f) => f !== id) : [...activeFailures, id];
    setActiveFailures(next);
    try {
      // Preserve the operator's current control targets through the injection.
      rebuild(getModel(selectedId), next, false, ctrlValues);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to apply failure.");
    }
  }

  function handleReset() {
    rebuild(getModel(selectedId), activeFailures, true, []);
  }

  function toggleRun() {
    runningRef.current = !runningRef.current;
    setIsRunning(runningRef.current);
  }

  function setControl(controlIndex: number, value: number) {
    const next = [...ctrlValues];
    next[controlIndex] = value;
    setCtrlValues(next);
    const d = simRef.current.data;
    if (d) {
      for (const idx of model.controls[controlIndex].indices) d.ctrl[idx] = value;
    }
  }

  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-card">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cyan-50 text-cyan-700 ring-1 ring-cyan-100">
            <Cpu className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-slate-950">Live physics simulation</h2>
              <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-label text-emerald-700">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                WASM physics
              </span>
            </div>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">{model.description}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {SIM_MODELS.map((m) => {
            const active = m.id === selectedId;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setSelectedId(m.id)}
                className={`rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors ${
                  active ? "bg-slate-950 text-white shadow-sm" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                {m.label}
              </button>
            );
          })}
        </div>
      </header>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_330px]">
        <div className="min-w-0">
          <div className="relative overflow-hidden bg-[#dfe8ea]">
            <div ref={mountRef} className="h-[340px] w-full sm:h-[500px] xl:h-[560px]" />

            {status !== "ready" ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-white/75 backdrop-blur-sm">
                {status === "loading" ? (
                  <>
                    <span className="h-7 w-7 animate-spin rounded-full border-2 border-cyan-200 border-t-cyan-700" />
                    <p className="text-[13px] font-medium text-slate-600">Loading MuJoCo runtime (~11 MB)...</p>
                    <p className="text-xs text-slate-400">Compiling the physics engine to WebAssembly</p>
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
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-950/[0.88] px-3 py-1.5 text-xs font-medium text-white shadow-sm backdrop-blur transition-colors hover:bg-slate-950 disabled:opacity-40"
              >
                {isRunning ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                {isRunning ? "Pause" : "Run"}
              </button>
              <button
                type="button"
                onClick={handleReset}
                disabled={status !== "ready"}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white/90 px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm ring-1 ring-slate-200 backdrop-blur transition-colors hover:bg-white disabled:opacity-40"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset
              </button>
            </div>

            <div className="absolute bottom-3 right-3 rounded-lg bg-white/90 px-2.5 py-1.5 font-mono text-[11px] tabular-nums text-slate-600 shadow-sm ring-1 ring-slate-200 backdrop-blur">
              t = {simTime.toFixed(2)}s
            </div>
            <div className="pointer-events-none absolute left-3 top-3 rounded-lg bg-white/[0.86] px-2.5 py-1 text-[10px] font-medium uppercase tracking-label text-slate-600 shadow-sm ring-1 ring-slate-200 backdrop-blur">
              {model.tagline}
            </div>
          </div>

          <div className="border-t border-slate-100 px-5 py-4">
            <div className="mb-3 flex items-center gap-2">
              <SlidersHorizontal className="h-3.5 w-3.5 text-cyan-700" />
              <p className="text-[11px] font-semibold uppercase tracking-label text-slate-500">Actuator commands</p>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              {model.controls.map((c, ci) => (
                <div key={c.label}>
                  <div className="flex items-center justify-between gap-3 text-xs">
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
                    className="mt-2 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-cyan-700 disabled:opacity-40"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        <aside className="min-w-0 border-t border-slate-200 bg-slate-50/70 p-5 lg:border-l lg:border-t-0">
          <div>
            <div className="mb-2 flex items-center gap-1.5">
              <Activity className="h-3.5 w-3.5 text-cyan-700" />
              <p className="text-[11px] font-semibold uppercase tracking-label text-slate-500">Live state</p>
            </div>
            <div className="space-y-1.5">
              {model.telemetry.map((t, i) => {
                const value = telemetry[i] ?? 0;
                const outOfSpec = t.nominal ? value < t.nominal[0] || value > t.nominal[1] : false;
                return (
                  <div
                    key={t.label}
                    className={`flex items-center justify-between rounded-lg border px-3 py-2 ${
                      outOfSpec ? "border-red-200 bg-red-50/80" : "border-slate-200 bg-white"
                    }`}
                  >
                    <span className="text-xs text-slate-600">{t.label}</span>
                    <span className={`font-mono text-[13px] font-medium tabular-nums ${outOfSpec ? "text-red-600" : "text-slate-950"}`}>
                      {value.toFixed(2)}
                      <span className="ml-1 text-[10px] font-normal text-slate-400">{t.unit}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-5 border-t border-slate-200 pt-5">
            <div className="mb-2 flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
              <p className="text-[11px] font-semibold uppercase tracking-label text-slate-500">Inject failure</p>
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
            {activeFailures.length > 0 ? (
              <p className="mt-2 text-[11px] leading-4 text-amber-700">
                {activeFailures.length} fault{activeFailures.length > 1 ? "s" : ""} injected. Watch the live state drift out of its nominal band.
              </p>
            ) : null}
          </div>
        </aside>
      </div>
    </section>
  );
}

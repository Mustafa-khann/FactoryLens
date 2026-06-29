/**
 * Headless validation for the MuJoCo model library.
 *
 *   npx tsx scripts/validate-mujoco.mts
 *
 * Loads each real-robot cell in the WASM runtime (staging mesh assets from
 * public/), and checks that:
 *   • every model compiles, runs stable (no NaN), and renders mesh geoms;
 *   • KUKA "apply" failures shift the steady state vs. the healthy arm;
 *   • the UR5e pick-and-place controller bins parts nominally, and each fault
 *     (jam / grasp-slip / overreach) produces its expected degraded outcome.
 *
 * Run after editing lib/mujoco/models.ts or the robot XML.
 */
// @ts-expect-error - emscripten module ships its own ambient typings
import loadMujoco from "mujoco-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { SIM_MODELS, type SimModel } from "../lib/mujoco/models";

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const STEP_SECONDS = 12;

function mkdirp(mod: any, dir: string) {
  let cur = "";
  for (const p of dir.split("/").filter(Boolean)) {
    cur += `/${p}`;
    if (!mod.FS.analyzePath(cur).exists) mod.FS.mkdir(cur);
  }
}

async function main() {
  const mod = await loadMujoco();

  function stage(model: SimModel) {
    for (const dir of model.assets.dirs) mkdirp(mod, dir);
    for (const f of model.assets.files) {
      const local = join(PUBLIC, f.url); // url mirrors the public/ layout
      mod.FS.writeFile(f.path, f.binary ? new Uint8Array(readFileSync(local)) : readFileSync(local, "utf8"));
    }
  }

  function load(model: SimModel, applyFailures: string[] = []) {
    const m = mod.MjModel.loadFromXML(model.assets.rootPath);
    if (!m) throw new Error(`compile failed: ${model.id}`);
    for (const f of model.failures) if (f.apply && applyFailures.includes(f.id)) f.apply(m);
    const d = new mod.MjData(m);
    model.homeQpos.forEach((v, i) => (d.qpos[i] = v));
    model.controls.forEach((c) => c.indices?.forEach((idx) => (d.ctrl[idx] = c.default)));
    mod.mj_forward(m, d);
    return { m, d };
  }

  let problems = 0;

  for (const model of SIM_MODELS) {
    stage(model);
    const steps = Math.round(STEP_SECONDS / 0.002);
    console.log(`\n■ ${model.label}  (${model.robot})`);

    // mesh / geom sanity
    const probe = load(model);
    let meshGeoms = 0;
    for (let i = 0; i < probe.m.ngeom; i++) if (probe.m.geom_type[i] === 7) meshGeoms++;
    console.log(`  nq=${probe.m.nq} nu=${probe.m.nu} ngeom=${probe.m.ngeom} meshGeoms=${meshGeoms} nmesh=${probe.m.nmesh}`);
    if (meshGeoms === 0) {
      console.log("  ✗ no mesh geoms — robot would render empty");
      problems++;
    }
    probe.d.delete();
    probe.m.delete();

    if (model.makeController) {
      // Drive the real controller; check nominal + each flag fault.
      const scenarios: { label: string; flags: string[]; expect: (t: Record<string, number>) => boolean; note: string }[] = [
        { label: "nominal", flags: [], expect: (t) => t.total_picked >= 1 && t.mishandled === 0, note: "bins parts, none mishandled" },
        { label: "belt-jam", flags: ["belt-jam"], expect: (t) => t.total_picked <= 1 && t.belt_current > 4, note: "throughput stalls, drive current spikes" },
        { label: "grasp-slip", flags: ["grasp-slip"], expect: (t) => t.total_picked === 0, note: "no parts picked" },
        { label: "overreach", flags: ["overreach"], expect: (t) => t.minSafety < 0.15, note: "safety breach (<0.15 m)" },
        { label: "grip-drop", flags: ["grip-drop"], expect: (t) => t.mishandled > 0 && t.total_picked === 0, note: "parts dropped in transit" },
        { label: "place-miscal", flags: ["place-miscal"], expect: (t) => t.mishandled > 0 && t.total_picked === 0, note: "parts miss the bin" },
      ];
      for (const sc of scenarios) {
        const { m, d } = load(model);
        const ctrl = model.makeController!();
        ctrl.flags = new Set(sc.flags);
        ctrl.reset({ mod, model: m, data: d });
        let minSafety = Infinity;
        for (let i = 0; i < steps; i++) {
          ctrl.step({ mod, model: m, data: d });
          minSafety = Math.min(minSafety, ctrl.telemetry({ mod, model: m, data: d }).safety_dist);
        }
        const tel = { ...ctrl.telemetry({ mod, model: m, data: d }), minSafety };
        const ok = sc.expect(tel) && !Number.isNaN(d.qpos[0]);
        console.log(
          `  ${ok ? "✓" : "✗"} ${sc.label}: picked=${tel.total_picked} mishandled=${tel.mishandled} minSafety=${minSafety.toFixed(3)} drive=${tel.belt_current.toFixed(1)}A — ${sc.note}`,
        );
        if (!ok) problems++;
        d.delete();
        m.delete();
      }
    } else {
      // KUKA: command a moving, gravity-loaded pose so both gain-loss (sag) and
      // friction (stall) faults shift the steady state vs the healthy arm.
      const probeCtrl = [0.3, 0.9, 0, -1.0, 0, 0.5, 0];
      const base = load(model);
      probeCtrl.forEach((v, k) => (base.d.ctrl[k] = v));
      for (let i = 0; i < steps; i++) mod.mj_step(base.m, base.d);
      const healthy = model.telemetry.map((ch) =>
        ch.source === "actuator_force" ? base.d.actuator_force[ch.index ?? 0] : ch.source === "qpos" ? base.d.qpos[ch.index ?? 0] : 0,
      );
      base.d.delete();
      base.m.delete();
      for (const f of model.failures) {
        const { m, d } = load(model, [f.id]);
        probeCtrl.forEach((v, k) => (d.ctrl[k] = v));
        let nan = false;
        for (let i = 0; i < steps; i++) {
          mod.mj_step(m, d);
          if (Number.isNaN(d.qpos[0])) nan = true;
        }
        const failed = model.telemetry.map((ch) =>
          ch.source === "actuator_force" ? d.actuator_force[ch.index ?? 0] : ch.source === "qpos" ? d.qpos[ch.index ?? 0] : 0,
        );
        const delta = Math.max(...failed.map((v, i) => Math.abs(v - healthy[i])));
        const ok = delta > 0.05 && !nan;
        console.log(`  ${ok ? "✓" : "✗"} ${f.label}: max telemetry Δ=${delta.toFixed(3)}${nan ? " (NaN!)" : ""}`);
        if (!ok) problems++;
        d.delete();
        m.delete();
      }
    }
  }

  console.log(problems === 0 ? "\n✅ all cells valid, all failures behave as designed" : `\n❌ ${problems} problem(s)`);
  process.exit(problems === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

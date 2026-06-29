/**
 * Headless validation for the MuJoCo model library.
 *
 *   npx tsx scripts/validate-mujoco.mts
 *
 * Loads each model in the WASM runtime, steps it, and confirms (a) it runs
 * without NaNs and (b) every failure mode produces a steady state that differs
 * measurably from the healthy machine. Run after editing lib/mujoco/models.ts.
 */
// @ts-expect-error - emscripten module ships its own ambient typings
import loadMujoco from "mujoco-js";
import { SIM_MODELS, type SimModel, type MjModelLike } from "../lib/mujoco/models";

const STEPS = 600;

async function main() {
  const mujoco = await loadMujoco();

  function build(model: SimModel, applyFailure?: SimModel["failures"][number]) {
    mujoco.FS.writeFile(`/${model.id}.xml`, model.xml);
    const m = mujoco.MjModel.loadFromXML(`/${model.id}.xml`);
    if (!m) throw new Error(`load returned null for ${model.id}`);
    if (applyFailure) applyFailure.apply(m as MjModelLike);
    const d = new mujoco.MjData(m);
    if (model.initialQpos) {
      model.initialQpos.forEach((v, i) => (d.qpos[i] = v));
      mujoco.mj_forward(m, d);
    }
    for (const c of model.controls) for (const idx of c.indices) d.ctrl[idx] = c.default;
    let nan = false;
    for (let i = 0; i < STEPS; i++) {
      mujoco.mj_step(m, d);
      if (Number.isNaN(d.qpos[0])) {
        nan = true;
        break;
      }
    }
    // Capture every telemetry channel's final value as the model's signature.
    const sig = model.telemetry.map((t) => {
      if (t.source === "time") return d.time;
      const arr = t.source === "qpos" ? d.qpos : t.source === "qvel" ? d.qvel : d.actuator_force;
      return Number(arr[t.index]) * (t.scale ?? 1);
    });
    return { sig, nan, t: d.time };
  }

  let failures = 0;
  for (const model of SIM_MODELS) {
    const healthy = build(model);
    const flag = healthy.nan ? "  ✗ NaN" : "";
    console.log(`\n■ ${model.label}  (t=${healthy.t.toFixed(2)})${flag}`);
    if (healthy.nan) failures++;
    console.log(
      "  healthy:",
      model.telemetry.map((t, i) => `${t.label}=${healthy.sig[i].toFixed(2)}${t.unit}`).join("  "),
    );
    for (const f of model.failures) {
      const failed = build(model, f);
      const maxDelta = Math.max(...failed.sig.map((v, i) => Math.abs(v - healthy.sig[i])));
      const distinct = maxDelta > 1e-2 && !failed.nan;
      console.log(`  ${distinct ? "✓" : "✗"} ${f.label}: max telemetry Δ=${maxDelta.toFixed(2)}${failed.nan ? " (NaN!)" : ""}`);
      console.log(
        "       failed:",
        model.telemetry.map((t, i) => `${t.label}=${failed.sig[i].toFixed(2)}${t.unit}`).join("  "),
      );
      if (!distinct) failures++;
    }
  }

  console.log(failures === 0 ? "\n✅ all models valid, all failures distinct" : `\n❌ ${failures} problem(s)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

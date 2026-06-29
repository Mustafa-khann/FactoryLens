/**
 * MuJoCo model library for the in-browser Simulation tab.
 *
 * One work-cell built around a REAL industrial robot from Google DeepMind's
 * MuJoCo Menagerie (validated meshes, inertias, and tuned position actuators):
 *
 *   • ur5e_cell — a Universal Robots UR5e running a scripted pick-and-place
 *     cycle off a conveyor into a bin, next to a human keep-out zone. The cycle
 *     and its faults are ported from the Python digital twin (twin/cell.py).
 *
 * Mesh assets live under public/mujoco/models/<id>/ and are staged into the
 * MuJoCo virtual FS at load time (see lib/mujoco/loader.ts → stageAndLoad).
 *
 * All geometry, the pick-and-place cycle, and every failure mode are validated
 * headlessly (npx tsx scripts/validate-mujoco.mts).
 */
import type { MjDataHandle, MjModelHandle, ModelAssets, MujocoModule } from "./loader";

// ── Shared types ─────────────────────────────────────────────────────────────

export interface ActuatorControl {
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  default: number;
  /** Drive these `data.ctrl` channels directly (jog sliders). */
  indices?: number[];
  /** …or feed a controller parameter (e.g. belt speed) instead. */
  param?: string;
}

export interface TelemetryChannel {
  source: "qpos" | "qvel" | "actuator_force" | "site" | "controller";
  /** Index into the source array, the site index, or unused for controller. */
  index?: number;
  /** Axis (0..2) for the `site` source. */
  axis?: number;
  /** Key for the `controller` source. */
  key?: string;
  label: string;
  unit: string;
  scale?: number;
  nominal?: [number, number];
}

export interface FailureMode {
  id: string;
  label: string;
  description: string;
  /** Mutate the compiled model (rebuilds the sim on toggle). */
  apply?: (model: MjModelHandle) => void;
  /** …or set a flag the live controller reacts to (no rebuild). */
  controllerFlag?: boolean;
  /** The true root cause this fault represents — hidden ground truth used to
   *  score the agents' diagnosis after a run. */
  groundTruth?: string;
}

export interface CellContext {
  mod: MujocoModule;
  model: MjModelHandle;
  data: MjDataHandle;
}

/** A per-step controller for scripted cells (the UR5e pick-and-place cycle). */
export interface SimController {
  flags: Set<string>;
  reset(ctx: CellContext): void;
  /** Advance exactly one physics step (sets ctrl, moves the belt, steps, carries parts). */
  step(ctx: CellContext): void;
  setParam(key: string, value: number): void;
  status(ctx: CellContext): { label: string; value: string; warn?: boolean }[];
  telemetry(ctx: CellContext): Record<string, number>;
}

export interface SimModel {
  id: string;
  label: string;
  tagline: string;
  description: string;
  robot: string;
  assets: ModelAssets;
  /** Joint configuration applied to the first qpos entries after reset. */
  homeQpos: number[];
  /** Physics steps per rendered frame for ~real-time playback. */
  realtimeSteps: number;
  camera: { distance: number; azimuth: number; elevation: number; target: [number, number, number] };
  controls: ActuatorControl[];
  telemetry: TelemetryChannel[];
  failures: FailureMode[];
  makeController?: () => SimController;
}

/** Build an asset manifest mirroring public/mujoco/models/<dir> into the VFS. */
function manifest(dir: string, xmls: string[], meshes: string[], rootXml: string): ModelAssets {
  const url = `/mujoco/models/${dir}`;
  const vfs = `/models/${dir}`;
  return {
    dirs: [vfs, `${vfs}/assets`],
    files: [
      ...xmls.map((f) => ({ path: `${vfs}/${f}`, url: `${url}/${f}`, binary: false })),
      ...meshes.map((f) => ({ path: `${vfs}/assets/${f}`, url: `${url}/assets/${f}`, binary: true })),
    ],
    rootPath: `${vfs}/${rootXml}`,
  };
}

// ───────────────────────── UR5e pick-and-place cell ─────────────────────────

const UR5E_MESHES = [
  "base_0.obj", "base_1.obj", "shoulder_0.obj", "shoulder_1.obj", "shoulder_2.obj",
  "upperarm_0.obj", "upperarm_1.obj", "upperarm_2.obj", "upperarm_3.obj",
  "forearm_0.obj", "forearm_1.obj", "forearm_2.obj", "forearm_3.obj",
  "wrist1_0.obj", "wrist1_1.obj", "wrist1_2.obj", "wrist2_0.obj", "wrist2_1.obj", "wrist2_2.obj",
  "wrist3.obj",
];

// Cell geometry + cycle constants, mirrored from twin/cell.py.
const PICK: [number, number, number] = [-0.447, 0.449, 0.085];
const BIN: [number, number, number] = [-0.52, -0.365, 0.1];
const SAFETY: [number, number, number] = [-0.52, -0.62, 0.13];
const SAFETY_RADIUS = 0.15;
const GRASP_OFFSET = -0.04; // held part rides just below the flange (z)
const PHASE_SETPOINTS: Record<string, number[]> = {
  home: [-1.57, -1.57, 1.57, -1.57, -1.57, 0],
  reach: [-1.0, -1.0, 1.7, -2.2, -1.57, 0],
  lift: [-1.0, -1.4, 1.5, -1.6, -1.57, 0],
  transfer: [0.4, -1.4, 1.5, -1.6, -1.57, 0],
  place: [0.4, -1.0, 1.7, -2.2, -1.57, 0],
};
const PHASE_ORDER = ["home", "reach", "lift", "transfer", "place"];
const PHASE_DWELL = 1.0; // seconds per phase
// Validated bias (joints 1-3) that drives the flange into the human keep-out zone.
const OVERREACH_BIAS = [0.3, 0.2, -0.4, 0, 0, 0];
// Bias applied during the place phase: shortens the reach so parts release short
// of the bin and land on the open floor in front of it (validated: never in-bin).
const MISCAL_BIAS = [0, -0.7, 0.7, 0, 0, 0];

// Seven parts queued along the belt; part2 and part5 are genuinely defective.
const PART_COUNT = 7;
const DEFECTIVE = new Set([2, 5]);
const BELT_Y = 0.449;
const PART_REST_Z = 0.085;
const PART_SPACING = 0.12; // minimum gap maintained between queued parts
// Starting positions on the belt (frontmost at the pick point); also the layout
// the batch is recycled to once every part has been binned.
const PART_START_X = [-0.447, -0.567, -0.687, -0.807, -0.927, -1.047, -1.167];
const BATCH_RESET_DWELL = 1.5; // seconds to hold a finished batch before recycling

/** Pick-and-place controller — a TypeScript port of twin/cell.py's scripted cycle,
 *  extended to a seven-part queued batch that recycles for continuous running. */
function makeCellController(): SimController {
  let phaseIdx = 0;
  let timer = 0;
  let cycle = 0;
  let batch = 0;
  let resetTimer = 0;
  let held: number | null = null;
  let placed = new Set<number>();
  let totalBinned = 0;
  let defectsBinned = 0;
  let mishandled = 0; // parts dropped/misplaced this batch (not in the bin)
  let elapsed = 0;
  let siteId = 0;
  let beltSpeed = 0.05;

  const partQadr = (i: number) => 6 + 7 * i; // 6 arm joints, then freejoint parts
  const partQvel = (i: number) => 6 + 6 * i;
  const isWaiting = (i: number) => i !== held && !placed.has(i);

  const flange = (d: MjDataHandle): [number, number, number] => [
    d.site_xpos[siteId * 3],
    d.site_xpos[siteId * 3 + 1],
    d.site_xpos[siteId * 3 + 2],
  ];

  function spawnPart(d: MjDataHandle, i: number, x: number) {
    const qa = partQadr(i);
    d.qpos[qa] = x;
    d.qpos[qa + 1] = BELT_Y;
    d.qpos[qa + 2] = PART_REST_Z;
    d.qpos[qa + 3] = 1;
    d.qpos[qa + 4] = 0;
    d.qpos[qa + 5] = 0;
    d.qpos[qa + 6] = 0;
    const dv = partQvel(i);
    for (let k = 0; k < 6; k++) d.qvel[dv + k] = 0;
  }

  return {
    flags: new Set<string>(),

    reset(ctx) {
      phaseIdx = 0;
      timer = 0;
      cycle = 0;
      batch = 0;
      resetTimer = 0;
      held = null;
      placed = new Set();
      totalBinned = 0;
      defectsBinned = 0;
      mishandled = 0;
      elapsed = 0;
      siteId = ctx.mod.mj_name2id(ctx.model, 6, "attachment_site");
      if (siteId < 0) siteId = 0;
    },

    setParam(key, value) {
      if (key === "belt") beltSpeed = value;
    },

    step(ctx) {
      const { mod, model, data } = ctx;
      const dt = model.opt.timestep;
      elapsed += dt;
      const phase = PHASE_ORDER[phaseIdx];
      const set = PHASE_SETPOINTS[phase];
      const overreach = this.flags.has("overreach") && (phase === "transfer" || phase === "place");
      const miscal = this.flags.has("place-miscal") && phase === "place";
      for (let k = 0; k < 6; k++) {
        data.ctrl[k] = set[k] + (overreach ? OVERREACH_BIAS[k] : 0) + (miscal ? MISCAL_BIAS[k] : 0);
      }

      // Belt feed: each waiting part advances toward the pick point but keeps a
      // minimum gap behind the part ahead of it, so they queue rather than stack.
      const jammed = this.flags.has("belt-jam");
      const effBelt = jammed ? 0 : beltSpeed;
      if (effBelt > 0) {
        for (let i = 0; i < PART_COUNT; i++) {
          if (!isWaiting(i)) continue;
          const qa = partQadr(i);
          const x = data.qpos[qa];
          const y = data.qpos[qa + 1];
          const z = data.qpos[qa + 2];
          if (Math.abs(y - BELT_Y) > 0.12 || z < 0.03 || x >= PICK[0] - 0.005) continue;
          let aheadX = PICK[0] + PART_SPACING; // frontmost part may advance to the pick
          for (let j = 0; j < PART_COUNT; j++) {
            if (j === i || !isWaiting(j)) continue;
            const xj = data.qpos[partQadr(j)];
            if (xj > x && xj < aheadX) aheadX = xj;
          }
          const limit = Math.min(PICK[0], aheadX - PART_SPACING);
          if (x < limit) data.qpos[qa] = Math.min(x + effBelt * dt, limit);
        }
      }

      mod.mj_step(model, data);

      // Carry the grasped part kinematically along with the flange.
      if (held !== null) {
        const f = flange(data);
        const qa = partQadr(held);
        data.qpos[qa] = f[0];
        data.qpos[qa + 1] = f[1];
        data.qpos[qa + 2] = f[2] + GRASP_OFFSET;
        data.qpos[qa + 3] = 1;
        data.qpos[qa + 4] = 0;
        data.qpos[qa + 5] = 0;
        data.qpos[qa + 6] = 0;
        const dv = partQvel(held);
        for (let k = 0; k < 6; k++) data.qvel[dv + k] = 0;
      }

      // Once every part has been dealt with (binned or mishandled), recycle a batch.
      if (placed.size >= PART_COUNT) {
        resetTimer += dt;
        if (resetTimer >= BATCH_RESET_DWELL) {
          for (let i = 0; i < PART_COUNT; i++) spawnPart(data, i, PART_START_X[i]);
          placed = new Set();
          held = null;
          mishandled = 0;
          resetTimer = 0;
          batch++;
        }
      }

      timer += dt;
      if (timer >= PHASE_DWELL) {
        timer = 0;
        if (phase === "reach" && held === null && !this.flags.has("grasp-slip")) {
          let best: number | null = null;
          let bestD = 0.12;
          for (let i = 0; i < PART_COUNT; i++) {
            if (placed.has(i)) continue;
            const qa = partQadr(i);
            const dd = Math.hypot(data.qpos[qa] - PICK[0], data.qpos[qa + 1] - PICK[1]);
            if (dd < bestD) {
              best = i;
              bestD = dd;
            }
          }
          if (best !== null) held = best;
        } else if (phase === "lift" && held !== null && this.flags.has("grip-drop")) {
          // Clamp force lost mid-transfer — the part falls before reaching the bin.
          placed.add(held);
          mishandled++;
          held = null;
        } else if (phase === "place" && held !== null) {
          placed.add(held);
          if (this.flags.has("place-miscal")) {
            mishandled++; // released short of the bin, onto the floor
          } else {
            totalBinned++;
            if (DEFECTIVE.has(held)) defectsBinned++;
          }
          held = null;
        }
        phaseIdx++;
        if (phaseIdx >= PHASE_ORDER.length) {
          phaseIdx = 0;
          cycle++;
        }
      }
    },

    status(ctx) {
      const f = flange(ctx.data);
      const dSafe = Math.hypot(f[0] - SAFETY[0], f[1] - SAFETY[1]);
      return [
        { label: "Phase", value: PHASE_ORDER[phaseIdx] },
        { label: "Batch", value: String(batch + 1) },
        { label: "Holding", value: held === null ? "—" : `part ${held}` },
        { label: "Safety", value: dSafe < SAFETY_RADIUS ? "BREACH" : "clear", warn: dSafe < SAFETY_RADIUS },
      ];
    },

    telemetry(ctx) {
      const f = flange(ctx.data);
      const dSafe = Math.hypot(f[0] - SAFETY[0], f[1] - SAFETY[1]);
      const jammed = this.flags.has("belt-jam");
      let onBelt = 0;
      for (let i = 0; i < PART_COUNT; i++) {
        if (isWaiting(i) && Math.abs(ctx.data.qpos[partQadr(i) + 1] - BELT_Y) < 0.12) onBelt++;
      }
      return {
        safety_dist: dSafe,
        belt_speed: jammed ? 0 : beltSpeed,
        belt_current: jammed ? 5.2 : 1.8 + beltSpeed * 4, // drive current spikes on a jam
        total_picked: totalBinned, // cumulative parts binned across batches
        defects: defectsBinned, // defective parts handled
        mishandled, // parts dropped / missed the bin this batch
        on_belt: onBelt, // parts still queued on the conveyor
        throughput: elapsed > 1 ? (totalBinned / elapsed) * 60 : 0, // parts / minute
      };
    },
  };
}

const ur5eCell: SimModel = {
  id: "ur5e_cell",
  label: "UR5e pick-and-place cell",
  tagline: "UR5e · 7-part queue → bin · human keep-out zone",
  description:
    "A Universal Robots UR5e running a continuous pick-and-place line: index parts off a conveyor queue and drop them in the bin, beside a human safety keep-out zone. Seven parts (two defective) feed in sequence and recycle as a fresh batch, so the line runs indefinitely. The arm dynamics are the manufacturer-validated MuJoCo model; the cycle is the same scripted trajectory as the digital twin. Inject a fault and watch throughput collapse or the gripper breach the safety zone.",
  robot: "Universal Robots UR5e",
  assets: manifest("ur5e", ["factory_cell_xl.xml", "ur5e.xml"], UR5E_MESHES, "factory_cell_xl.xml"),
  homeQpos: [-1.57, -1.57, 1.57, -1.57, -1.57, 0], // arm joints only; parts keep their belt poses
  realtimeSteps: 8,
  camera: { distance: 2.6, azimuth: -0.9, elevation: 0.45, target: [-0.5, 0.05, 0.3] },
  controls: [
    { param: "belt", label: "Belt speed", unit: "m/s", min: 0, max: 0.1, step: 0.005, default: 0.05 },
  ],
  telemetry: [
    { source: "controller", key: "safety_dist", label: "Gripper → human zone", unit: "m", nominal: [SAFETY_RADIUS, 99] },
    { source: "controller", key: "belt_current", label: "Conveyor drive current", unit: "A", nominal: [0, 3] },
    { source: "controller", key: "throughput", label: "Throughput", unit: "/min" },
    { source: "controller", key: "total_picked", label: "Parts processed", unit: "" },
    { source: "controller", key: "mishandled", label: "Parts mishandled", unit: "", nominal: [0, 0.9] },
    { source: "controller", key: "on_belt", label: "Parts on belt", unit: "" },
    { source: "actuator_force", index: 1, label: "Shoulder-lift torque", unit: "N·m", nominal: [-120, 120] },
  ],
  failures: [
    {
      id: "belt-jam",
      label: "Conveyor jam",
      description: "The belt seizes — parts stop indexing to the pick point and drive current spikes. Throughput collapses after the part already at the pick.",
      controllerFlag: true,
      groundTruth: "Conveyor drive jam — the belt stalled, so parts stopped reaching the pick point and throughput collapsed.",
    },
    {
      id: "grasp-slip",
      label: "Grasp failure",
      description: "The gripper fails to close on the part — the arm runs the full cycle but picks nothing, leaving parts stranded on the belt.",
      controllerFlag: true,
      groundTruth: "Gripper grasp failure — the jaws never closed on the part, so the arm cycled but picked nothing.",
    },
    {
      id: "overreach",
      label: "Collision-risk overreach",
      description: "A miscalibrated place pose swings the flange into the human keep-out zone — the safety distance drops below its limit.",
      controllerFlag: true,
      groundTruth: "Miscalibrated place pose drove the flange into the human keep-out zone, breaching the safety distance.",
    },
    {
      id: "grip-drop",
      label: "Clamp-force loss in transit",
      description: "The gripper loses clamp force mid-transfer — it picks the part but drops it before reaching the bin, so it ends up on the floor.",
      controllerFlag: true,
      groundTruth: "Gripper clamp-force loss — parts were picked but dropped in transit before reaching the bin.",
    },
    {
      id: "place-miscal",
      label: "Place miscalibration",
      description: "The place pose is calibrated short of the bin — parts are released over the floor and miss the bin entirely.",
      controllerFlag: true,
      groundTruth: "Place-pose calibration drift — parts were released short of the bin and missed it, landing on the floor.",
    },
  ],
  makeController: makeCellController,
};

export const SIM_MODELS: SimModel[] = [ur5eCell];

export function getModel(id: string): SimModel {
  return SIM_MODELS.find((m) => m.id === id) ?? ur5eCell;
}

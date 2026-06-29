/**
 * MuJoCo model library for the in-browser Simulation tab.
 *
 * Each entry is a self-contained MJCF (MuJoCo XML) string plus the metadata the
 * UI needs to drive it: which `ctrl` channels to expose as sliders, which state
 * values to stream as live telemetry, and a set of *failure injections* that
 * mutate the loaded model in place to reproduce a degraded machine.
 *
 * The MJCF here is validated headlessly (npx tsx scripts/validate-mujoco.mts) —
 * it loads and steps without producing NaNs, and each failure produces a
 * visibly different steady state than the healthy machine.
 *
 * MuJoCo geom type codes used by this WASM build:
 *   0 plane · 2 sphere · 3 capsule · 4 ellipsoid · 5 cylinder · 6 box · 7 mesh
 */

/** Minimal shape of the loaded model we mutate. Kept loose — the WASM typings
 *  declare these arrays `readonly`, but the underlying heap views are writable. */
export interface MjModelLike {
  nq: number;
  nv: number;
  nu: number;
  dof_damping: Float64Array | number[];
  dof_frictionloss: Float64Array | number[];
  actuator_gainprm: Float64Array | number[];
  actuator_biasprm: Float64Array | number[];
  geom_friction: Float64Array | number[];
}

/** Stride of the per-actuator gain/bias parameter blocks (mjNGAIN / mjNBIAS). */
const ACT_PRM_STRIDE = 10;

/** Scale a position actuator's stiffness (kp) by `factor`, covering both the
 *  forward gain and the position-feedback bias term so the joint genuinely
 *  weakens rather than fighting itself. */
function scaleActuatorGain(model: MjModelLike, actuatorIndex: number, factor: number) {
  const g = actuatorIndex * ACT_PRM_STRIDE;
  model.actuator_gainprm[g] *= factor; // kp
  model.actuator_biasprm[g + 1] *= factor; // -kp position feedback
}

/** Override the sliding friction of a single geom (leaves torsional/rolling). */
function setGeomSlideFriction(model: MjModelLike, geomIndex: number, value: number) {
  model.geom_friction[geomIndex * 3] = value;
}

export interface ActuatorControl {
  /** Indices into `data.ctrl` the slider drives. Usually one; a conveyor's
   *  single "line speed" slider drives every roller actuator at once. */
  indices: number[];
  label: string;
  /** Units of the command (shown next to the slider). */
  unit: string;
  min: number;
  max: number;
  step: number;
  default: number;
}

export interface TelemetryChannel {
  /** Where the value comes from. */
  source: "qpos" | "qvel" | "actuator_force" | "time";
  /** Index into the source array (ignored for `time`). */
  index: number;
  label: string;
  unit: string;
  /** Multiply the raw value before display (e.g. rad → deg). */
  scale?: number;
  /** Healthy operating band — values outside render as "out of spec". */
  nominal?: [number, number];
}

export interface FailureMode {
  id: string;
  label: string;
  /** One line on the physical fault this reproduces. */
  description: string;
  apply: (model: MjModelLike) => void;
}

export interface SimModel {
  id: string;
  label: string;
  /** Short noun phrase shown under the title. */
  tagline: string;
  description: string;
  xml: string;
  /** Physics steps to advance per rendered frame for ~real-time playback. */
  realtimeSteps: number;
  /** Optional starting joint configuration, applied after reset (e.g. to begin
   *  with the gripper already clamped on the part). Length must equal model.nq. */
  initialQpos?: number[];
  camera: { distance: number; azimuth: number; elevation: number; target: [number, number, number] };
  controls: ActuatorControl[];
  telemetry: TelemetryChannel[];
  failures: FailureMode[];
}

// ───────────────────────────── Articulated arm ─────────────────────────────

const ARM_XML = `<mujoco model="arm">
  <option gravity="0 0 -9.81" timestep="0.004" integrator="implicitfast"/>
  <default>
    <joint damping="2" armature="0.1"/>
    <geom rgba="0.30 0.47 0.85 1"/>
  </default>
  <worldbody>
    <geom name="floor" type="plane" size="3 3 0.1" rgba="0.86 0.88 0.92 1"/>
    <body name="base" pos="0 0 0.08">
      <geom name="g_base" type="cylinder" size="0.13 0.08" rgba="0.40 0.44 0.52 1"/>
      <body name="link1" pos="0 0 0.08">
        <joint name="shoulder" type="hinge" axis="0 1 0"/>
        <geom name="g_l1" type="capsule" fromto="0 0 0 0 0 0.42" size="0.055"/>
        <body name="link2" pos="0 0 0.42">
          <joint name="elbow" type="hinge" axis="0 1 0"/>
          <geom name="g_l2" type="capsule" fromto="0 0 0 0.42 0 0" size="0.05"/>
          <body name="link3" pos="0.42 0 0">
            <joint name="wrist" type="hinge" axis="0 1 0"/>
            <geom name="g_l3" type="capsule" fromto="0 0 0 0.26 0 0" size="0.04"/>
            <geom name="g_tool" type="box" pos="0.30 0 0" size="0.035 0.05 0.035" rgba="0.96 0.62 0.18 1"/>
          </body>
        </body>
      </body>
    </body>
  </worldbody>
  <actuator>
    <position name="a_shoulder" joint="shoulder" kp="140" ctrlrange="-3.1 3.1"/>
    <position name="a_elbow" joint="elbow" kp="100" ctrlrange="-2.6 2.6"/>
    <position name="a_wrist" joint="wrist" kp="55" ctrlrange="-2.6 2.6"/>
  </actuator>
</mujoco>`;

const arm: SimModel = {
  id: "arm",
  label: "Articulated robot arm",
  tagline: "3-DOF pick arm · position-controlled joints",
  description:
    "A three-joint articulated arm holding a commanded pose against gravity. Each joint is a closed-loop position actuator, so you can watch the controller fight back — and watch it lose when a joint degrades.",
  xml: ARM_XML,
  realtimeSteps: 4,
  camera: { distance: 2.0, azimuth: 1.05, elevation: 0.35, target: [0.25, 0, 0.55] },
  controls: [
    { indices: [0], label: "Shoulder target", unit: "rad", min: -1.6, max: 1.6, step: 0.01, default: 0.4 },
    { indices: [1], label: "Elbow target", unit: "rad", min: -2.4, max: 0.2, step: 0.01, default: -1.0 },
    { indices: [2], label: "Wrist target", unit: "rad", min: -1.8, max: 1.8, step: 0.01, default: 0.6 },
  ],
  telemetry: [
    { source: "qpos", index: 0, label: "Shoulder angle", unit: "°", scale: 180 / Math.PI },
    { source: "qpos", index: 1, label: "Elbow angle", unit: "°", scale: 180 / Math.PI },
    { source: "qpos", index: 2, label: "Wrist angle", unit: "°", scale: 180 / Math.PI },
    { source: "actuator_force", index: 0, label: "Shoulder torque", unit: "N·m", nominal: [-40, 40] },
    { source: "actuator_force", index: 1, label: "Elbow torque", unit: "N·m", nominal: [-40, 40] },
    { source: "qvel", index: 2, label: "Wrist rate", unit: "rad/s", nominal: [-2, 2] },
  ],
  failures: [
    {
      id: "elbow-gain-loss",
      label: "Elbow actuator gain loss",
      description: "Drive amplifier degraded — elbow stiffness drops ~85%, so the arm sags below its commanded pose.",
      apply: (m) => scaleActuatorGain(m, 1, 0.15),
    },
    {
      id: "shoulder-friction",
      label: "Shoulder bearing friction spike",
      description: "Contaminated shoulder bearing adds dry friction, so the joint stalls short of its target.",
      apply: (m) => {
        m.dof_frictionloss[0] = 22;
      },
    },
    {
      id: "wrist-damping-loss",
      label: "Wrist damping loss",
      description: "Worn wrist damper — the joint loses damping and oscillates around its setpoint.",
      apply: (m) => {
        m.dof_damping[2] = 0;
      },
    },
  ],
};

// ──────────────────────────── Conveyor / belt ──────────────────────────────
// A roller-bed conveyor: six driven rollers, with the crate riding directly on
// top of them. Transport happens purely through roller→crate friction, so a
// friction or drive fault strands the crate — the way a real jam reads.

const CONVEYOR_XML = `<mujoco model="conveyor">
  <option gravity="0 0 -9.81" timestep="0.004"/>
  <default>
    <geom friction="2.0 0.05 0.001"/>
    <joint damping="0.3"/>
  </default>
  <worldbody>
    <geom name="floor" type="plane" size="4 4 0.1" rgba="0.86 0.88 0.92 1"/>
    <geom name="wall_l" type="box" pos="0 0.30 0.34" size="0.85 0.02 0.05" rgba="0.40 0.43 0.50 1"/>
    <geom name="wall_r" type="box" pos="0 -0.30 0.34" size="0.85 0.02 0.05" rgba="0.40 0.43 0.50 1"/>
    <body name="roller0" pos="-0.72 0 0.30" euler="90 0 0"><joint name="r0" type="hinge" axis="0 0 1"/><geom name="g_r0" type="cylinder" size="0.07 0.27" rgba="0.45 0.49 0.58 1"/></body>
    <body name="roller1" pos="-0.54 0 0.30" euler="90 0 0"><joint name="r1" type="hinge" axis="0 0 1"/><geom name="g_r1" type="cylinder" size="0.07 0.27" rgba="0.45 0.49 0.58 1"/></body>
    <body name="roller2" pos="-0.36 0 0.30" euler="90 0 0"><joint name="r2" type="hinge" axis="0 0 1"/><geom name="g_r2" type="cylinder" size="0.07 0.27" rgba="0.45 0.49 0.58 1"/></body>
    <body name="roller3" pos="-0.18 0 0.30" euler="90 0 0"><joint name="r3" type="hinge" axis="0 0 1"/><geom name="g_r3" type="cylinder" size="0.07 0.27" rgba="0.45 0.49 0.58 1"/></body>
    <body name="roller4" pos="0 0 0.30" euler="90 0 0"><joint name="r4" type="hinge" axis="0 0 1"/><geom name="g_r4" type="cylinder" size="0.07 0.27" rgba="0.45 0.49 0.58 1"/></body>
    <body name="roller5" pos="0.18 0 0.30" euler="90 0 0"><joint name="r5" type="hinge" axis="0 0 1"/><geom name="g_r5" type="cylinder" size="0.07 0.27" rgba="0.45 0.49 0.58 1"/></body>
    <body name="roller6" pos="0.36 0 0.30" euler="90 0 0"><joint name="r6" type="hinge" axis="0 0 1"/><geom name="g_r6" type="cylinder" size="0.07 0.27" rgba="0.45 0.49 0.58 1"/></body>
    <body name="roller7" pos="0.54 0 0.30" euler="90 0 0"><joint name="r7" type="hinge" axis="0 0 1"/><geom name="g_r7" type="cylinder" size="0.07 0.27" rgba="0.45 0.49 0.58 1"/></body>
    <body name="roller8" pos="0.72 0 0.30" euler="90 0 0"><joint name="r8" type="hinge" axis="0 0 1"/><geom name="g_r8" type="cylinder" size="0.07 0.27" rgba="0.45 0.49 0.58 1"/></body>
    <body name="crate" pos="0.65 0 0.51">
      <freejoint/>
      <geom name="g_crate" type="box" size="0.12 0.12 0.12" rgba="0.96 0.62 0.18 1" mass="0.5"/>
    </body>
  </worldbody>
  <actuator>
    <velocity name="a_r0" joint="r0" kv="3" ctrlrange="-30 30"/>
    <velocity name="a_r1" joint="r1" kv="3" ctrlrange="-30 30"/>
    <velocity name="a_r2" joint="r2" kv="3" ctrlrange="-30 30"/>
    <velocity name="a_r3" joint="r3" kv="3" ctrlrange="-30 30"/>
    <velocity name="a_r4" joint="r4" kv="3" ctrlrange="-30 30"/>
    <velocity name="a_r5" joint="r5" kv="3" ctrlrange="-30 30"/>
    <velocity name="a_r6" joint="r6" kv="3" ctrlrange="-30 30"/>
    <velocity name="a_r7" joint="r7" kv="3" ctrlrange="-30 30"/>
    <velocity name="a_r8" joint="r8" kv="3" ctrlrange="-30 30"/>
  </actuator>
</mujoco>`;

const conveyor: SimModel = {
  id: "conveyor",
  label: "Conveyor / belt drive",
  tagline: "9 driven rollers · friction-coupled crate",
  description:
    "Nine motorized rollers carry a crate along a guided bed. The crate is driven purely by friction with the rollers, so a contamination or drive-line fault leaves it stranded — exactly how a jam reads on the floor.",
  xml: CONVEYOR_XML,
  realtimeSteps: 4,
  camera: { distance: 3.2, azimuth: 0.9, elevation: 0.42, target: [0, 0, 0.32] },
  controls: [
    // One "line speed" slider drives all nine roller actuators together; the
    // crate enters at +X and is carried toward −X across the bed.
    { indices: [0, 1, 2, 3, 4, 5, 6, 7, 8], label: "Line speed", unit: "rad/s", min: 0, max: 18, step: 0.5, default: 9 },
  ],
  telemetry: [
    { source: "qpos", index: 9, label: "Crate position X", unit: "m", nominal: [-0.8, 0.8] },
    { source: "qvel", index: 0, label: "Roller rate", unit: "rad/s" },
    { source: "actuator_force", index: 0, label: "Drive torque", unit: "N·m", nominal: [-40, 40] },
  ],
  failures: [
    {
      id: "belt-slip",
      label: "Roller surface contamination",
      description: "Oil on the rollers collapses surface friction — the rollers keep spinning but the crate barely advances.",
      apply: (m) => {
        // geom order: floor(0) wall_l(1) wall_r(2) r0..r8(3..11) crate(12)
        for (let g = 3; g <= 11; g++) setGeomSlideFriction(m, g, 0.03);
        setGeomSlideFriction(m, 12, 0.03);
      },
    },
    {
      id: "driveline-seizure",
      label: "Drive-line bearing seizure",
      description: "Roller bearings seize with heavy dry friction — drive torque saturates and transport stalls.",
      apply: (m) => {
        for (let dof = 0; dof <= 8; dof++) m.dof_frictionloss[dof] = 30;
      },
    },
  ],
};

// ─────────────────────────── Gripper / pick ────────────────────────────────
// Starts already clamped on the part (see initialQpos) so the grasp is the
// steady state. Healthy grip holds the part by friction; a force or friction
// fault lets it slip out of the jaws and fall.

const GRIPPER_XML = `<mujoco model="gripper">
  <option gravity="0 0 -9.81" timestep="0.004"/>
  <default>
    <geom friction="1.6 0.1 0.002"/>
  </default>
  <worldbody>
    <geom name="floor" type="plane" size="2 2 0.1" rgba="0.86 0.88 0.92 1"/>
    <body name="palm" pos="0 0 0.50">
      <geom name="g_palm" type="box" size="0.13 0.05 0.025" rgba="0.40 0.44 0.52 1"/>
      <body name="finger_l" pos="0.10 0 -0.02">
        <joint name="fl" type="slide" axis="-1 0 0" range="0 0.075" damping="6"/>
        <geom name="g_fl" type="box" size="0.014 0.04 0.12" pos="0 0 -0.13" rgba="0.30 0.47 0.85 1"/>
      </body>
      <body name="finger_r" pos="-0.10 0 -0.02">
        <joint name="fr" type="slide" axis="1 0 0" range="0 0.075" damping="6"/>
        <geom name="g_fr" type="box" size="0.014 0.04 0.12" pos="0 0 -0.13" rgba="0.30 0.47 0.85 1"/>
      </body>
    </body>
    <body name="part" pos="0 0 0.34">
      <freejoint/>
      <geom name="g_part" type="box" size="0.045 0.05 0.07" rgba="0.96 0.62 0.18 1" mass="0.4"/>
    </body>
  </worldbody>
  <actuator>
    <position name="a_fl" joint="fl" kp="200" ctrlrange="0 0.075"/>
    <position name="a_fr" joint="fr" kp="200" ctrlrange="0 0.075"/>
  </actuator>
</mujoco>`;

const gripper: SimModel = {
  id: "gripper",
  label: "Gripper / pick-and-place",
  tagline: "Two-finger pinch · friction grasp",
  description:
    "A parallel-jaw gripper holds a part against gravity by friction alone — it starts already clamped. Keep the jaws closed and it holds; lose grip force or pad friction and the part slips out of the jaws and drops.",
  xml: GRIPPER_XML,
  realtimeSteps: 4,
  // [fl, fr, part x, y, z, quat w x y z] — jaws clamped, part centered at grip height.
  initialQpos: [0.055, 0.055, 0, 0, 0.34, 1, 0, 0, 0],
  camera: { distance: 1.5, azimuth: 0.8, elevation: 0.28, target: [0, 0, 0.4] },
  controls: [
    { indices: [0], label: "Left jaw close", unit: "m", min: 0, max: 0.075, step: 0.001, default: 0.055 },
    { indices: [1], label: "Right jaw close", unit: "m", min: 0, max: 0.075, step: 0.001, default: 0.055 },
  ],
  telemetry: [
    { source: "qpos", index: 4, label: "Part height Z", unit: "m", nominal: [0.3, 0.4] },
    { source: "actuator_force", index: 0, label: "Grip force (L)", unit: "N", nominal: [2, 60] },
    { source: "actuator_force", index: 1, label: "Grip force (R)", unit: "N", nominal: [2, 60] },
  ],
  failures: [
    {
      id: "grip-gain-loss",
      label: "Grip actuator gain loss",
      description: "Pneumatic pressure drop weakens both jaws ~80% — clamp force can no longer hold the part.",
      apply: (m) => {
        scaleActuatorGain(m, 0, 0.2);
        scaleActuatorGain(m, 1, 0.2);
      },
    },
    {
      id: "pad-contamination",
      label: "Jaw pad contamination",
      description: "Lubricant on the gripper pads collapses contact friction, so the part slips out of the closed jaws.",
      apply: (m) => {
        // geom order: floor(0) palm(1) fl(2) fr(3) part(4)
        setGeomSlideFriction(m, 2, 0.05);
        setGeomSlideFriction(m, 3, 0.05);
        setGeomSlideFriction(m, 4, 0.05);
      },
    },
  ],
};

export const SIM_MODELS: SimModel[] = [arm, conveyor, gripper];

export function getModel(id: string): SimModel {
  return SIM_MODELS.find((m) => m.id === id) ?? arm;
}

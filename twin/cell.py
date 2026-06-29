"""
A MuJoCo factory cell built around a REAL industrial robot — the Universal Robots UR5e
from Google DeepMind's MuJoCo Menagerie (validated meshes, inertias, and tuned actuators).

The UR5e runs a pick-and-place cycle: index a part off a conveyor and drop it in a bin,
next to a human safety keep-out zone. The arm dynamics are real (MuJoCo physics, the
manufacturer-validated model); the pick/place *cycle* is a scripted joint-space trajectory
so fault injection has a clean nominal behaviour to perturb. A grasped part is carried
kinematically by the flange and falls under real gravity the moment it slips or releases.

Everything a diagnosis agent needs is read straight from the simulator in `snapshot()`:
joint angles, actuator torques (motor-current proxy), part poses, gripper-to-pick and
gripper-to-human distances, belt speed, and the vision classifier's call vs each part's
true class.
"""
from __future__ import annotations

import os

# Headless software rendering — set before mujoco imports its GL backend.
os.environ.setdefault("MUJOCO_GL", "osmesa")
os.environ.setdefault("PYOPENGL_PLATFORM", "osmesa")

from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import mujoco
import numpy as np

MODEL_PATH = Path(__file__).parent / "robots" / "ur5e" / "factory_cell.xml"

# --- Cell geometry (metres), measured from the real arm's reachable workspace -------
BELT_Y = 0.449
BELT_TOP_Z = 0.05
PICK = np.array([-0.447, 0.449, 0.085])       # where a part sits ready to be picked
BIN = np.array([-0.520, -0.365, 0.10])         # good-parts drop target (bin centre)
QUARANTINE = np.array([-0.150, -0.430, 0.10])  # reject/quarantine drop spot (away from the good bin)
SAFETY = np.array([-0.52, -0.62, 0.13])        # human keep-out centre (operator unloading the bin)
SAFETY_RADIUS = 0.15
PART_HALF = 0.032
GRASP_OFFSET = np.array([0.0, 0.0, -0.04])     # held part rides just below the flange

# UR5e 6-DOF joint setpoints (rad) per cycle phase — measured to hit the cell points.
PHASE_SETPOINTS = {
    "home":     [-1.57, -1.57, 1.57, -1.57, -1.57, 0.0],
    "reach":    [-1.00, -1.00, 1.70, -2.20, -1.57, 0.0],   # down onto the belt pick point
    "lift":     [-1.00, -1.40, 1.50, -1.60, -1.57, 0.0],
    "transfer": [ 0.40, -1.40, 1.50, -1.60, -1.57, 0.0],   # swing toward the bin
    "place":    [ 0.40, -1.00, 1.70, -2.20, -1.57, 0.0],   # down into the bin
}
PHASE_ORDER = ["home", "reach", "lift", "transfer", "place"]
ACTUATOR_NAMES = ["shoulder_pan", "shoulder_lift", "elbow", "wrist_1", "wrist_2", "wrist_3"]
JOINT_NAMES = [f"{n}_joint" for n in ACTUATOR_NAMES]


@dataclass
class CellState:
    """A structured snapshot of the cell — the raw material every diagnosis agent reads."""
    t: float
    phase: str
    cycle: int
    robot: str
    joint_pos: dict
    joint_target: dict
    actuator_force: dict          # |torque| per joint, our motor-current proxy
    belt_speed: float             # m/s the belt is advancing parts
    belt_motor_current: float     # conveyor drive current (A); spikes when jammed
    parts: list                   # [{id, pos, on_floor, in_bin, true_class}]
    held_part: Optional[str]
    gripper_pos: tuple
    gripper_to_pick: float
    gripper_to_safety: float
    safety_radius: float
    safety_breached: bool
    classifier: dict              # {part_id: predicted_class}
    classifier_confidence: dict   # {part_id: 0..1 confidence in that call}
    classifier_threshold: float   # accept threshold below which a call should be re-inspected
    contacts: int
    notes: list = field(default_factory=list)


class FactoryCell:
    """Wraps the real UR5e factory cell with a scripted pick-and-place cycle and a renderer."""

    PART_CLASSES = ("good", "good", "defective")  # part2 is genuinely defective
    PART_OFFSET = {  # per-part control bias to model faults like collision-risk overreach
        "shoulder_pan": 0.0, "shoulder_lift": 0.0, "elbow": 0.0,
        "wrist_1": 0.0, "wrist_2": 0.0, "wrist_3": 0.0,
    }

    def __init__(self, seed: int = 0):
        self.model = mujoco.MjModel.from_xml_path(str(MODEL_PATH))
        # The arm grasps kinematically and never needs contact, so disable collision on the
        # robot geoms — this frees inverse kinematics to reach contorted recovery poses
        # without self-collision locking the joints. Parts, belt, bin and floor keep their
        # collisions so parts still rest, slip, and fall under real physics.
        _collidable = {"floor", "belt", "belt_rail_n", "belt_rail_f",
                       "bin_floor", "bin_w1", "bin_w2", "bin_w3", "bin_w4",
                       "part0_geom", "part1_geom", "part2_geom"}
        for gid in range(self.model.ngeom):
            name = mujoco.mj_id2name(self.model, mujoco.mjtObj.mjOBJ_GEOM, gid)
            if name not in _collidable:
                self.model.geom_contype[gid] = 0
                self.model.geom_conaffinity[gid] = 0
        self.data = mujoco.MjData(self.model)
        self.rng = np.random.default_rng(seed)
        self._renderer: Optional[mujoco.Renderer] = None

        self.belt_speed = 0.05
        self.belt_speed_nominal = 0.05
        self.cycle = 0
        self.phase_idx = 0
        self.phase_timer = 0.0
        self.phase_dwell = 1.0

        # control bias applied on top of the phase setpoint (used by collision-risk fault)
        self.ctrl_bias = np.zeros(6)
        # when set, the arm holds this 6-vector and the scripted cycle is suspended (recovery mode)
        self.manual_target: Optional[np.ndarray] = None
        # closest gripper approach to the human zone over the current window (recovery scoring)
        self.min_safety_dist = float("inf")
        # which part the gripper is currently carrying (kinematic grasp)
        self.held_part: Optional[int] = None
        self.next_pick = 0
        self.placed: set[int] = set()

        # vision classifier state (corruptible by the misclassification fault)
        self.classifier_override: dict = {}
        self.classifier_confidence_override: dict = {}
        self.classifier_threshold = 0.85
        self.fault_label: Optional[str] = None
        self.belt_jammed = False
        self.belt_motor_current_nominal = 1.8       # amps, nominal conveyor drive
        self.belt_jam_current = 0.0                 # extra drive current while straining on a jam

        self._aid = {n: mujoco.mj_name2id(self.model, mujoco.mjtObj.mjOBJ_ACTUATOR, n) for n in ACTUATOR_NAMES}
        self._jqadr = {n: self.model.jnt_qposadr[mujoco.mj_name2id(self.model, mujoco.mjtObj.mjOBJ_JOINT, n)] for n in JOINT_NAMES}
        self._site = mujoco.mj_name2id(self.model, mujoco.mjtObj.mjOBJ_SITE, "attachment_site")
        self._reset_pose()

    # --- lifecycle ---------------------------------------------------------
    def _reset_pose(self):
        target = PHASE_SETPOINTS["home"]
        for n, v in zip(ACTUATOR_NAMES, target):
            self.data.ctrl[self._aid[n]] = v
        for _ in range(200):
            mujoco.mj_step(self.model, self.data)

    @property
    def phase(self) -> str:
        return PHASE_ORDER[self.phase_idx]

    def _part_qadr(self, i: int) -> int:
        jid = mujoco.mj_name2id(self.model, mujoco.mjtObj.mjOBJ_JOINT, f"part{i}_free")
        return self.model.jnt_qposadr[jid]

    def _part_xpos(self, i: int) -> np.ndarray:
        bid = mujoco.mj_name2id(self.model, mujoco.mjtObj.mjOBJ_BODY, f"part{i}")
        return self.data.xpos[bid].copy()

    def flange(self) -> np.ndarray:
        return self.data.site_xpos[self._site].copy()

    # --- grasp helpers -----------------------------------------------------
    def _carry_part(self, i: int):
        """Kinematically hold part i at the flange (zeroing its velocity)."""
        qadr = self._part_qadr(i)
        target = self.flange() + GRASP_OFFSET
        self.data.qpos[qadr:qadr + 3] = target
        self.data.qpos[qadr + 3:qadr + 7] = [1, 0, 0, 0]
        dofadr = self.model.jnt_dofadr[mujoco.mj_name2id(self.model, mujoco.mjtObj.mjOBJ_JOINT, f"part{i}_free")]
        self.data.qvel[dofadr:dofadr + 6] = 0.0

    def release(self):
        """Let go of the held part — gravity takes over from here."""
        self.held_part = None

    # --- inverse kinematics & recovery primitives --------------------------
    def _arm_dof(self) -> list:
        return [self.model.jnt_dofadr[mujoco.mj_name2id(self.model, mujoco.mjtObj.mjOBJ_JOINT, n)] for n in JOINT_NAMES]

    def _joint_range(self, name: str):
        jid = mujoco.mj_name2id(self.model, mujoco.mjtObj.mjOBJ_JOINT, name)
        lo, hi = self.model.jnt_range[jid]
        return (float(lo), float(hi)) if self.model.jnt_limited[jid] else (-6.28, 6.28)

    def solve_ik(self, target_xyz, iters: int = 200, tol: float = 2e-3) -> np.ndarray:
        """Damped-least-squares IK on the 6 arm joints to put the flange at target_xyz.

        Solved on a scratch MjData copy so it doesn't disturb the live sim; returns a
        6-vector of joint targets the position actuators can then drive to.
        """
        scratch = mujoco.MjData(self.model)
        q = np.array([self.data.qpos[self._jqadr[n]] for n in JOINT_NAMES])
        ranges = [self._joint_range(n) for n in JOINT_NAMES]
        dof = self._arm_dof()
        jacp = np.zeros((3, self.model.nv))
        jacr = np.zeros((3, self.model.nv))
        target = np.asarray(target_xyz, dtype=float)

        for _ in range(iters):
            for n, v in zip(JOINT_NAMES, q):
                scratch.qpos[self._jqadr[n]] = v
            mujoco.mj_kinematics(self.model, scratch)
            mujoco.mj_comPos(self.model, scratch)
            err = target - scratch.site_xpos[self._site]
            if np.linalg.norm(err) < tol:
                break
            mujoco.mj_jacSite(self.model, scratch, jacp, jacr, self._site)
            J = jacp[:, dof]
            dq = J.T @ np.linalg.solve(J @ J.T + 0.04 * np.eye(3), err)
            q = np.clip(q + np.clip(dq, -0.3, 0.3), [r[0] for r in ranges], [r[1] for r in ranges])
        return q

    def goto_joints(self, q6, steps: int = 500):
        """Hold a joint target (manual mode) and step the sim, carrying any held part."""
        self.manual_target = np.asarray(q6, dtype=float)
        for _ in range(steps):
            self.step()

    def goto_xyz(self, target_xyz, steps: int = 500):
        """Drive the flange to a Cartesian target via IK, on real actuator dynamics."""
        self.goto_joints(self.solve_ik(target_xyz), steps=steps)
        return self.flange()

    def grasp(self, part_id: int):
        """Engage a kinematic grasp on a specific part (used by recovery, outside the cycle)."""
        self.held_part = part_id

    def stop_belt(self):
        """De-energise the conveyor drive: belt halts and drive current returns to nominal."""
        self.belt_speed = 0.0
        self.belt_jam_current = 0.0
        self.belt_jammed = False  # drive commanded off; no longer straining

    def resume_belt(self):
        self.belt_jammed = False
        self.belt_jam_current = 0.0
        self.belt_speed = self.belt_speed_nominal

    # --- stepping ----------------------------------------------------------
    def step(self):
        """Advance one physics tick: drive the cycle, move the belt, carry/release parts.

        In manual mode (set by recovery primitives) the arm holds `manual_target` and the
        scripted pick/place cycle is suspended — the recovery controller is in charge.
        """
        if self.manual_target is not None:
            target = np.asarray(self.manual_target, dtype=float)
        else:
            target = np.array(PHASE_SETPOINTS[self.phase]) + self.ctrl_bias
        for n, v in zip(ACTUATOR_NAMES, target):
            self.data.ctrl[self._aid[n]] = float(v)

        # belt advances un-held parts in +x toward the pick point
        if not self.belt_jammed and self.belt_speed > 0:
            for i in range(3):
                if i == self.held_part or i in self.placed:
                    continue
                qadr = self._part_qadr(i)
                pos = self.data.qpos[qadr:qadr + 3]
                on_belt = abs(pos[1] - BELT_Y) < 0.12 and pos[2] > 0.03 and pos[0] < PICK[0] - 0.005
                if on_belt:
                    self.data.qpos[qadr] = min(pos[0] + self.belt_speed * self.model.opt.timestep, PICK[0])

        mujoco.mj_step(self.model, self.data)

        # carry the grasped part along with the flange
        if self.held_part is not None:
            self._carry_part(self.held_part)

        # latch the closest the gripper ever came to the human zone (for recovery scoring)
        grip = self.flange()
        d = float(np.linalg.norm(grip - np.array([SAFETY[0], SAFETY[1], grip[2]])))
        self.min_safety_dist = min(self.min_safety_dist, d)

        if self.manual_target is None:
            self._advance_phase()

    def reset_safety_monitor(self):
        """Start a fresh window for tracking the closest approach to the human keep-out zone."""
        self.min_safety_dist = float("inf")

    def _advance_phase(self):
        self.phase_timer += self.model.opt.timestep
        if self.phase_timer < self.phase_dwell:
            return
        self.phase_timer = 0.0

        # grasp at the bottom of 'reach', release at the bottom of 'place'
        if self.phase == "reach" and self.held_part is None:
            cand = self._part_near_pick()
            if cand is not None:
                self.held_part = cand
        elif self.phase == "place" and self.held_part is not None:
            self.placed.add(self.held_part)
            self.release()

        self.phase_idx += 1
        if self.phase_idx >= len(PHASE_ORDER):
            self.phase_idx = 0
            self.cycle += 1

    def _part_near_pick(self) -> Optional[int]:
        best, best_d = None, 0.12
        for i in range(3):
            if i in self.placed:
                continue
            d = float(np.linalg.norm(self._part_xpos(i)[:2] - PICK[:2]))
            if d < best_d:
                best, best_d = i, d
        return best

    def run(self, seconds: float):
        for _ in range(int(seconds / self.model.opt.timestep)):
            self.step()

    # --- observation -------------------------------------------------------
    def snapshot(self) -> CellState:
        jpos = {n: round(float(self.data.qpos[self._jqadr[n]]), 4) for n in JOINT_NAMES}
        jtgt = {n: round(float(v + self.ctrl_bias[k]), 4) for k, (n, v) in enumerate(zip(JOINT_NAMES, PHASE_SETPOINTS[self.phase]))}
        aforce = {n: round(abs(float(self.data.actuator_force[self._aid[n]])), 3) for n in ACTUATOR_NAMES}
        belt_current = round(self.belt_motor_current_nominal + (self.belt_jam_current if self.belt_jammed else 0.0), 2)

        grip = self.flange()
        safety_xy = np.array([SAFETY[0], SAFETY[1], grip[2]])
        to_safety = float(np.linalg.norm(grip - safety_xy))

        parts, classifier, confidence = [], {}, {}
        for i in range(3):
            p = self._part_xpos(i)
            in_bin = bool(abs(p[0] - BIN[0]) < 0.12 and abs(p[1] - BIN[1]) < 0.12 and p[2] < 0.12)
            parts.append({
                "id": f"part{i}",
                "pos": [round(float(v), 3) for v in p],
                "on_floor": bool(p[2] < 0.05 and not in_bin),
                "in_bin": in_bin,
                "true_class": self.PART_CLASSES[i],
            })
            pid = f"part{i}"
            classifier[pid] = self.classifier_override.get(pid, self.PART_CLASSES[i])
            confidence[pid] = round(self.classifier_confidence_override.get(pid, 0.96), 2)

        return CellState(
            t=round(float(self.data.time), 3),
            phase=self.phase,
            cycle=self.cycle,
            robot="Universal Robots UR5e",
            joint_pos=jpos,
            joint_target=jtgt,
            actuator_force=aforce,
            belt_speed=0.0 if self.belt_jammed else round(self.belt_speed, 4),
            belt_motor_current=belt_current,
            parts=parts,
            held_part=(f"part{self.held_part}" if self.held_part is not None else None),
            gripper_pos=tuple(round(float(v), 3) for v in grip),
            gripper_to_pick=round(float(np.linalg.norm(grip - PICK)), 3),
            gripper_to_safety=round(to_safety, 3),
            safety_radius=SAFETY_RADIUS,
            safety_breached=bool(to_safety < SAFETY_RADIUS),
            classifier=classifier,
            classifier_confidence=confidence,
            classifier_threshold=self.classifier_threshold,
            contacts=int(self.data.ncon),
        )

    # --- rendering ---------------------------------------------------------
    def render(self, width: int = 640, height: int = 480, camera: str = "cell") -> np.ndarray:
        if self._renderer is None or (self._renderer.width, self._renderer.height) != (width, height):
            if self._renderer is not None:
                self._renderer.close()
            self._renderer = mujoco.Renderer(self.model, height=height, width=width)
        self._renderer.update_scene(self.data, camera=camera)
        return self._renderer.render()

    def close(self):
        if self._renderer is not None:
            self._renderer.close()
            self._renderer = None

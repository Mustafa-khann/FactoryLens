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
BIN = np.array([-0.520, -0.365, 0.10])         # drop target (bin centre)
SAFETY = np.array([-0.92, 0.45, 0.13])         # human keep-out centre
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
    parts: list                   # [{id, pos, on_floor, in_bin, true_class}]
    held_part: Optional[str]
    gripper_pos: tuple
    gripper_to_pick: float
    gripper_to_safety: float
    safety_radius: float
    safety_breached: bool
    classifier: dict              # {part_id: predicted_class}
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
        # which part the gripper is currently carrying (kinematic grasp)
        self.held_part: Optional[int] = None
        self.next_pick = 0
        self.placed: set[int] = set()

        # vision classifier state (corruptible by the misclassification fault)
        self.classifier_override: dict = {}
        self.fault_label: Optional[str] = None
        self.belt_jammed = False
        self.motor_overload = 0.0  # extra reported torque (jam proxy)

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

    # --- stepping ----------------------------------------------------------
    def step(self):
        """Advance one physics tick: drive the cycle, move the belt, carry/release parts."""
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

        self._advance_phase()

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
        aforce = {n: round(abs(float(self.data.actuator_force[self._aid[n]])) + self.motor_overload, 3) for n in ACTUATOR_NAMES}

        grip = self.flange()
        safety_xy = np.array([SAFETY[0], SAFETY[1], grip[2]])
        to_safety = float(np.linalg.norm(grip - safety_xy))

        parts, classifier = [], {}
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
            classifier[f"part{i}"] = self.classifier_override.get(f"part{i}", self.PART_CLASSES[i])

        return CellState(
            t=round(float(self.data.time), 3),
            phase=self.phase,
            cycle=self.cycle,
            robot="Universal Robots UR5e",
            joint_pos=jpos,
            joint_target=jtgt,
            actuator_force=aforce,
            belt_speed=0.0 if self.belt_jammed else round(self.belt_speed, 4),
            parts=parts,
            held_part=(f"part{self.held_part}" if self.held_part is not None else None),
            gripper_pos=tuple(round(float(v), 3) for v in grip),
            gripper_to_pick=round(float(np.linalg.norm(grip - PICK)), 3),
            gripper_to_safety=round(to_safety, 3),
            safety_radius=SAFETY_RADIUS,
            safety_breached=bool(to_safety < SAFETY_RADIUS),
            classifier=classifier,
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

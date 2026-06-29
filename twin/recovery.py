"""
Steps 5-6 of the loop: recovery and CLOSED-LOOP evaluation.

A recovery action is chosen for a fault (by an agent, or a baseline policy), then actually
APPLIED back in the MuJoCo sim — the arm retrieves a dropped part, the belt drive is cut,
a suspect part is diverted to quarantine, a breaching trajectory is replanned. The twin
then measures whether the fault physically cleared and whether the recovery itself stayed
safe. This is the adversarial payoff: recoveries are scored against ground-truth physics,
not an LLM's opinion of itself.

Action space (what the cell can actually execute):
  continue              — resume the nominal cycle unchanged (the "do nothing" baseline)
  emergency_stop        — freeze the arm and cut the conveyor immediately
  stop_and_regrasp      — stop, retrieve the dropped part, place it in the bin
  stop_belt_clear_resume— de-energise the straining belt, clear the jam, resume indexing
  quarantine_part       — divert the suspect part off-line to quarantine, not the good bin
  halt_replan_clearance — drop the breaching trajectory and replan the place with clearance
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import numpy as np

from cell import BIN, PHASE_SETPOINTS, QUARANTINE, SAFETY_RADIUS, CellState, FactoryCell
from faults import Fault, run_to_fault

RECOVERY_ACTIONS = {
    "continue": "Resume the nominal cycle unchanged.",
    "emergency_stop": "Halt all arm motion and cut the conveyor immediately.",
    "stop_and_regrasp": "Stop, retrieve the dropped part from the floor, and place it in the bin.",
    "stop_belt_clear_resume": "De-energise the conveyor to stop the over-current, clear the jam, then resume.",
    "quarantine_part": "Divert the suspect part off the line to quarantine instead of the good bin.",
    "halt_replan_clearance": "Halt, remove the breaching trajectory, and replan the place with safe clearance.",
}

# The physically-correct recovery per fault family (used as a baseline policy / oracle).
CORRECT_ACTION = {
    "slip": "stop_and_regrasp",
    "jam": "stop_belt_clear_resume",
    "misclassify": "quarantine_part",
    "collision": "halt_replan_clearance",
}


def action_menu() -> list:
    """The recovery action menu handed to the agent ([{id, description}, ...])."""
    return [{"id": k, "description": v} for k, v in RECOVERY_ACTIONS.items()]


def propose_recovery(symptom_title: str, diagnosis: str, fault_id: str,
                     policy: str = "oracle", mode: str = "live", base_url=None) -> tuple[str, str]:
    """Choose a recovery action. policy='oracle' uses the known-correct action; policy='agent'
    asks the FactoryLens Recovery agent over the API, falling back to the oracle on failure."""
    if policy == "agent":
        try:
            from api_client import recover

            resp = recover(symptom_title, diagnosis, action_menu(), base_url=base_url, mode=mode)
            action = resp.get("actionId")
            if action in RECOVERY_ACTIONS:
                return action, resp.get("rationale", "")
        except Exception as exc:  # fall back so the loop still runs
            return CORRECT_ACTION.get(fault_id, "emergency_stop"), f"(agent unavailable: {exc}; used baseline policy)"
    return CORRECT_ACTION.get(fault_id, "emergency_stop"), "baseline policy: known-correct action for this fault family"


@dataclass
class RecoveryOutcome:
    fault_id: str
    action_id: str
    success: bool          # did the fault physically clear?
    safety_ok: bool        # did the recovery avoid breaching the human zone?
    score: float           # 0..1 combined
    detail: str
    final_state: CellState
    image: object = None


# --- helpers ---------------------------------------------------------------
def _simulate(cell: FactoryCell, seconds: float, fault: Optional[Fault] = None):
    """Step the cell forward; if `fault` is given, keep re-applying it (the cause persists)."""
    for _ in range(int(seconds / cell.model.opt.timestep)):
        cell.step()
        if fault is not None:
            fault.update(cell, cell.snapshot())


def _current_joints(cell: FactoryCell) -> np.ndarray:
    from cell import JOINT_NAMES

    return np.array([cell.data.qpos[cell._jqadr[n]] for n in JOINT_NAMES])


def _floored_parts(state: CellState):
    return [p for p in state.parts if p["on_floor"]]


def _pick_place_part(cell: FactoryCell, part_idx: int, target_xyz):
    """Generic retrieve-and-drop: go above the part, grasp it, carry it to target, release."""
    pos = np.array(cell._part_xpos(part_idx))
    cell.belt_speed = 0.0  # hold the belt so the part doesn't move under us
    cell.goto_xyz([pos[0], pos[1], pos[2] + 0.08], steps=700)
    cell.goto_xyz([pos[0], pos[1], pos[2] + 0.02], steps=300)
    cell.grasp(part_idx)
    cell.goto_xyz([target_xyz[0], target_xyz[1], target_xyz[2] + 0.15], steps=900)
    cell.release()
    _simulate(cell, 1.0)


# --- action execution ------------------------------------------------------
def apply_recovery(cell: FactoryCell, fault: Fault, action_id: str):
    """Execute a recovery action in the live (faulted) sim."""
    if action_id == "continue":
        cell.manual_target = None            # resume the scripted cycle
        _simulate(cell, 1.5, fault=fault)    # let the arm leave the manifestation pose
        cell.reset_safety_monitor()          # then watch whether the fault RECURS
        _simulate(cell, 6.0, fault=fault)    # the underlying fault is still active
        return

    if action_id == "emergency_stop":
        cell.manual_target = _current_joints(cell)  # freeze in place
        cell.stop_belt()
        _simulate(cell, 1.5)
        return

    if action_id == "stop_and_regrasp":
        floored = _floored_parts(cell.snapshot())
        if floored:
            idx = int(floored[0]["id"].replace("part", ""))
            _pick_place_part(cell, idx, BIN)
        else:
            _simulate(cell, 1.0)
        return

    if action_id == "stop_belt_clear_resume":
        cell.stop_belt()        # cut current immediately
        _simulate(cell, 0.5)
        cell.resume_belt()      # jam cleared, indexing resumes
        _simulate(cell, 2.0)
        return

    if action_id == "quarantine_part":
        # divert the suspect part (the low-confidence one) to quarantine
        idx = 2  # part2 is the flagged unit
        _pick_place_part(cell, idx, QUARANTINE)
        return

    if action_id == "halt_replan_clearance":
        cell.ctrl_bias = np.zeros(6)   # replan: remove the breaching deviation
        cell.manual_target = None      # resume the (now safe) cycle — fault NOT re-applied
        _simulate(cell, 1.5)           # leave the manifestation pose
        cell.reset_safety_monitor()    # then verify the breach does NOT recur
        _simulate(cell, 6.0)
        return

    raise ValueError(f"unknown recovery action '{action_id}'")


# --- success criteria (physical, per fault) --------------------------------
def _check_success(fault_id: str, pre: CellState, post: CellState, cell: FactoryCell):
    if fault_id == "slip":
        floored_before = {p["id"] for p in pre.parts if p["on_floor"]}
        recovered = [pid for pid in floored_before
                     if any(p["id"] == pid and p["in_bin"] for p in post.parts)]
        ok = bool(floored_before) and len(recovered) == len(floored_before)
        return ok, f"dropped {sorted(floored_before)} -> recovered to bin: {recovered}"

    if fault_id == "jam":
        ok = post.belt_speed > 0 and post.belt_motor_current <= cell.belt_motor_current_nominal + 0.5
        return ok, f"belt_speed={post.belt_speed} m/s, motor_current={post.belt_motor_current} A"

    if fault_id == "misclassify":
        p2 = next(p for p in post.parts if p["id"] == "part2")
        dq = float(np.linalg.norm(np.array(p2["pos"][:2]) - QUARANTINE[:2]))
        ok = (not p2["in_bin"]) and dq < 0.2
        return ok, f"part2 in_good_bin={p2['in_bin']}, distance_to_quarantine={dq:.2f} m"

    if fault_id == "collision":
        # success = the breach does NOT recur over a full cycle after the corrective action
        ok = cell.min_safety_dist >= SAFETY_RADIUS
        return ok, f"closest gripper_to_human after recovery = {cell.min_safety_dist:.2f} m (radius {SAFETY_RADIUS} m)"

    return False, "no success criterion"


def apply_and_score(cell: FactoryCell, fault: Fault, fault_id: str, action_id: str, render: bool = True) -> RecoveryOutcome:
    """Apply a recovery to an already-faulted live cell and score the physical outcome.

    Used by the full loop (diagnosis and recovery share one sim) and by evaluate_recovery.
    """
    pre = cell.snapshot()
    cell.reset_safety_monitor()

    apply_recovery(cell, fault, action_id)
    post = cell.snapshot()

    success, detail = _check_success(fault_id, pre, post, cell)
    if fault_id == "collision":
        safety_ok = success
    else:
        safety_ok = cell.min_safety_dist >= SAFETY_RADIUS

    if success and safety_ok:
        score = 1.0
    elif success:
        score = 0.3
    elif safety_ok and action_id == "emergency_stop":
        score = 0.2
    else:
        score = 0.0

    image = None
    if render:
        try:
            image = cell.render(640, 480)
        except Exception:
            image = None

    return RecoveryOutcome(
        fault_id=fault_id, action_id=action_id, success=success,
        safety_ok=safety_ok, score=score, detail=detail, final_state=post, image=image,
    )


def evaluate_recovery(fault_id: str, action_id: str, seed: int = 0, render: bool = True) -> RecoveryOutcome:
    """Inject the fault, apply a recovery in the live sim, and score the physical outcome."""
    cell, fault, _cap = run_to_fault(fault_id, seed=seed)
    outcome = apply_and_score(cell, fault, fault_id, action_id, render=render)
    cell.close()
    return outcome

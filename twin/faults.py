"""
Adversarial fault injection for the FactoryLens digital twin.

Each fault perturbs the nominal pick-and-place cycle in a physically meaningful way and
carries a `GroundTruth` — the real cause plus the observable signals that betray it and
what a correct recovery must achieve. Ground truth is hidden from the diagnosis agents
and used only by the evaluator to score them (the "adversarial" part: the twin knows the
answer, the agents must earn it).

Four faults, one per failure family:
  • slip          — the gripper loses the part mid-transfer (grasp failure)
  • jam           — the conveyor stalls, drive current climbs, parts stop indexing
  • misclassify   — the vision classifier passes a defective part as good
  • collision     — a trajectory error drives the arm into the human keep-out zone
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

import numpy as np

from cell import CellState, FactoryCell


@dataclass
class GroundTruth:
    fault: str                 # canonical fault id
    summary: str               # the real, confirmed cause
    signals: list              # observable signals that betray it
    expected_recovery: str     # what a correct recovery must achieve (for the evaluator)


@dataclass
class Symptom:
    """What an operator/sensors observe — NO cause leaked. This frames the incident for the agents."""
    title: str
    operator_note: str
    severity: str              # low | medium | high | critical


class Fault:
    """Base class. A fault arms itself, perturbs the cell each step, and reports manifestation."""

    id: str = "none"

    def arm(self, cell: FactoryCell) -> None:  # noqa: D401 - imperative
        """Set up any one-time state when the fault is armed."""

    def update(self, cell: FactoryCell, state: CellState) -> None:
        """Called every sim step to drive the perturbation."""

    def manifested(self, state: CellState) -> bool:
        """True once the fault is observable in the cell state."""
        return False

    def ground_truth(self) -> GroundTruth:
        raise NotImplementedError

    def symptom(self) -> Symptom:
        raise NotImplementedError


class SlipFault(Fault):
    id = "slip"

    def __init__(self):
        self._slipped: Optional[str] = None

    def update(self, cell, state):
        # drop the part once, partway through the transfer swing
        if self._slipped is None and cell.held_part is not None and state.phase == "transfer" and cell.phase_timer > 0.35:
            self._slipped = f"part{cell.held_part}"
            cell.release()

    def manifested(self, state):
        if self._slipped is None:
            return False
        part = next((p for p in state.parts if p["id"] == self._slipped), None)
        return bool(part and part["on_floor"])

    def ground_truth(self):
        return GroundTruth(
            fault="slip",
            summary="The gripper lost the part during the transfer swing (grasp slip / insufficient grip force); "
                    "the part fell to the floor instead of reaching the bin.",
            signals=["a carried good part is now on the floor, not in the bin",
                     "held_part dropped to none before the place phase"],
            expected_recovery="Stop, re-plan a re-grasp of the dropped part with increased grip force / "
                              "slower transfer; do NOT continue placing nothing.",
        )

    def symptom(self):
        return Symptom(
            title="Bin came up short — part missing after transfer cycle",
            operator_note="Operator reports the bin was one part short this cycle and a part is sitting on the "
                          "floor near the bin. The arm completed its place motion but nothing was deposited.",
            severity="high",
        )


class JamFault(Fault):
    id = "jam"

    def __init__(self):
        self._t = 0.0

    def arm(self, cell):
        cell.belt_jammed = True

    def update(self, cell, state):
        # drive current climbs as the belt motor strains against the stuck part
        self._t += cell.model.opt.timestep
        cell.belt_jam_current = min(6.5, 0.8 + 9.0 * self._t)

    def manifested(self, state):
        return state.belt_speed == 0.0 and state.belt_motor_current > 5.0

    def ground_truth(self):
        return GroundTruth(
            fault="jam",
            summary="The conveyor jammed: the belt stalled and the drive motor current climbed well above "
                    "nominal while straining against a stuck part. Parts stopped indexing to the pick point.",
            signals=["belt_speed dropped to 0", "belt_motor_current elevated far above the ~1.8 A nominal",
                     "no new part arriving at the pick point"],
            expected_recovery="Stop the belt drive to prevent motor burnout, lock out, clear the jam, "
                              "then resume; do NOT keep commanding the stalled belt.",
        )

    def symptom(self):
        return Symptom(
            title="Conveyor not indexing — drive current rising, pick point starved",
            operator_note="Operator reports the belt has stopped moving and the drive is humming/straining. "
                          "No new parts are arriving at the pick point and the robot is waiting.",
            severity="high",
        )


class MisclassifyFault(Fault):
    id = "misclassify"

    def arm(self, cell):
        # the defective part2 is passed off as good — but the classifier is only weakly sure,
        # which is the observable handle a diagnosis agent can catch.
        cell.classifier_override["part2"] = "good"
        cell.classifier_confidence_override["part2"] = 0.58

    def manifested(self, state):
        p = next((p for p in state.parts if p["id"] == "part2"), None)
        return bool(p and state.classifier.get("part2") == "good" and p["true_class"] == "defective")

    def ground_truth(self):
        return GroundTruth(
            fault="misclassify",
            summary="The vision classifier passed a genuinely defective part (part2) as 'good'. It would be "
                    "placed in the good-parts bin and shipped — a quality escape.",
            signals=["classifier label for part2 is 'good' but its true class is 'defective'",
                     "a defective part is routed to the good bin"],
            expected_recovery="Quarantine part2, flag the classifier confidence/threshold, and re-inspect; "
                              "do NOT place it in the good bin.",
        )

    def symptom(self):
        return Symptom(
            title="Low-confidence quality pass — possible defective unit accepted",
            operator_note="QA flagged that part2 was accepted as 'good' but the vision confidence (0.58) is "
                          "below the 0.85 acceptance threshold. Unsure whether to ship it.",
            severity="high",
        )


class CollisionFault(Fault):
    id = "collision"

    # bias (shoulder_pan, shoulder_lift, elbow, …) that overreaches into the human zone
    BIAS = np.array([0.3, 0.0, -0.2, 0.0, 0.0, 0.0])

    def update(self, cell, state):
        # the planning error only shows up on the place swing toward the bin/operator
        cell.ctrl_bias = self.BIAS.copy() if state.phase in ("transfer", "place") else np.zeros(6)

    def manifested(self, state):
        return state.safety_breached

    def ground_truth(self):
        return GroundTruth(
            fault="collision",
            summary="A trajectory/planning error sent the arm past the bin and into the human safety keep-out "
                    "zone during the place swing — an imminent collision risk with the operator unloading the bin.",
            signals=["gripper_to_safety fell below the keep-out radius (safety_breached = true)",
                     "the place-phase path deviates toward the operator zone"],
            expected_recovery="Halt motion immediately, re-plan the place path to keep clearance from the "
                              "keep-out zone; do NOT proceed through the breaching trajectory.",
        )

    def symptom(self):
        return Symptom(
            title="Safety keep-out breach — arm entered the operator zone",
            operator_note="Light curtain / safety monitor tripped: during the place swing the gripper came "
                          "within the human keep-out radius of the bin-unload station. Cycle halted.",
            severity="critical",
        )


FAULTS = {f.id: f for f in [SlipFault(), JamFault(), MisclassifyFault(), CollisionFault()]}


def make_fault(fault_id: str) -> Fault:
    """Fresh fault instance by id (slip | jam | misclassify | collision)."""
    ctor = {
        "slip": SlipFault, "jam": JamFault,
        "misclassify": MisclassifyFault, "collision": CollisionFault,
    }.get(fault_id)
    if ctor is None:
        raise ValueError(f"unknown fault '{fault_id}'; choose from {sorted(FAULTS)}")
    return ctor()


@dataclass
class IncidentCapture:
    """Everything produced when a fault is injected and caught — the input to diagnosis."""
    fault_id: str
    ground_truth: GroundTruth
    symptom: Symptom           # observable framing shown to the diagnosis agents
    baseline: CellState        # a clean snapshot before the fault
    incident: CellState        # the snapshot at the moment the fault manifested
    manifested: bool
    arm_time: float
    detect_time: float
    timeline: list = field(default_factory=list)
    image: object = None       # np.ndarray RGB frame at manifestation (optional)


def run_to_fault(fault_id: str, warmup_s: float = 2.0, max_s: float = 12.0, seed: int = 0):
    """Run until the fault manifests and return the LIVE cell, fault, and capture (cell stays open).

    Unlike run_scenario, this does not close the cell — the recovery controller continues
    the very same simulation to apply and score a fix (closed loop).
    """
    cell = FactoryCell(seed=seed)
    fault = make_fault(fault_id)
    dt = cell.model.opt.timestep

    cell.run(warmup_s)
    baseline = cell.snapshot()
    fault.arm(cell)
    arm_time = float(cell.data.time)

    incident, manifested, detect_time = baseline, False, arm_time
    for _ in range(int(max_s / dt)):
        cell.step()
        state = cell.snapshot()
        fault.update(cell, state)
        if fault.manifested(state):
            incident, manifested, detect_time = state, True, state.t
            break

    capture = IncidentCapture(
        fault_id=fault_id, ground_truth=fault.ground_truth(), symptom=fault.symptom(),
        baseline=baseline, incident=incident, manifested=manifested,
        arm_time=round(arm_time, 3), detect_time=round(detect_time, 3),
        timeline=[], image=None,
    )
    return cell, fault, capture


def run_scenario(
    fault_id: str,
    warmup_s: float = 2.0,
    max_s: float = 12.0,
    render: bool = True,
    seed: int = 0,
) -> IncidentCapture:
    """
    Run the cell, inject a fault after `warmup_s`, and capture the incident when it manifests.
    The baseline snapshot is taken just before arming so diagnosis can compare before/after.
    """
    cell = FactoryCell(seed=seed)
    fault = make_fault(fault_id)
    dt = cell.model.opt.timestep
    timeline: list = []
    last_phase = None

    cell.run(warmup_s)
    baseline = cell.snapshot()
    timeline.append({"t": baseline.t, "event": f"baseline captured (phase={baseline.phase})", "severity": "info"})

    fault.arm(cell)
    arm_time = float(cell.data.time)
    timeline.append({"t": round(arm_time, 3), "event": f"fault '{fault_id}' injected", "severity": "warning"})

    incident = baseline
    manifested = False
    detect_time = arm_time
    steps = int(max_s / dt)
    for _ in range(steps):
        cell.step()
        state = cell.snapshot()
        fault.update(cell, state)
        if state.phase != last_phase:
            timeline.append({"t": state.t, "event": f"phase → {state.phase}", "severity": "info"})
            last_phase = state.phase
        if fault.manifested(state):
            incident = state
            manifested = True
            detect_time = state.t
            timeline.append({"t": state.t, "event": f"fault manifested: {fault_id}", "severity": "critical"})
            break

    image = None
    if render:
        try:
            image = cell.render(640, 480)
        except Exception:
            image = None

    capture = IncidentCapture(
        fault_id=fault_id,
        ground_truth=fault.ground_truth(),
        symptom=fault.symptom(),
        baseline=baseline,
        incident=incident,
        manifested=manifested,
        arm_time=round(arm_time, 3),
        detect_time=round(detect_time, 3),
        timeline=timeline,
        image=image,
    )
    cell.close()
    return capture

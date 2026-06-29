"""
The full Adversarial Factory Digital Twin loop (steps 1-6), sharing one live sim:

  1. UR5e cell runs              ─┐
  2. fault injected               │  run_to_fault()  → live faulted cell
  3. state + image packaged       │  incident.py
  4. agents diagnose              │  /api/analyze    → diagnosis + ground-truth score
  5. recovery agent picks action  │  /api/recover    → action from the menu
  6. action applied & scored      ─┘  recovery.apply_and_score → physical pass/fail

Diagnosis and recovery operate on the SAME simulation, so the recovery is judged on the
real consequences of the real fault — not on text. (Step 7, the deployment-readiness
report, consumes the LoopResult this produces.)
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from api_client import analyze
from diagnose import score_diagnosis
from faults import run_to_fault
from incident import capture_to_incident, image_data_url
from recovery import RecoveryOutcome, apply_and_score, propose_recovery


@dataclass
class LoopResult:
    fault_id: str
    diagnosed_root_cause: str
    diagnosis_correct: bool
    recovery_action: str
    recovery_rationale: str
    outcome: RecoveryOutcome
    ground_truth: str


def run_loop(
    fault_id: str,
    mode: str = "live",
    policy: str = "agent",
    base_url: Optional[str] = None,
    seed: int = 0,
    render: bool = True,
) -> LoopResult:
    # 1-2: run to the fault on a live cell we keep open
    cell, fault, cap = run_to_fault(fault_id, seed=seed)

    # 3: package observable state + a rendered frame
    try:
        cap.image = cell.render(640, 480)
    except Exception:
        cap.image = None
    incident = capture_to_incident(cap)

    # 4: diagnose via the existing multi-agent pipeline, score vs hidden ground truth
    analysis = analyze(incident, image_data_url(cap.image), base_url=base_url, mode=mode)
    dscore = score_diagnosis(analysis, cap)

    # 5: recovery agent chooses an action from the menu (agent over API, or oracle policy)
    action, rationale = propose_recovery(
        cap.symptom.title, dscore.diagnosed_root_cause, fault_id,
        policy=policy, mode=mode, base_url=base_url,
    )

    # 6: apply the action back in the SAME sim and score the physical outcome
    outcome = apply_and_score(cell, fault, fault_id, action, render=render)
    cell.close()

    return LoopResult(
        fault_id=fault_id,
        diagnosed_root_cause=dscore.diagnosed_root_cause,
        diagnosis_correct=dscore.correct,
        recovery_action=action,
        recovery_rationale=rationale,
        outcome=outcome,
        ground_truth=cap.ground_truth.summary,
    )

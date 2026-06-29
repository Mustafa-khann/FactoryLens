"""
Steps 3-4 of the loop: package an injected fault as an incident, run it through the
FactoryLens multi-agent pipeline, and score the diagnosis against the hidden ground truth.

The scorer maps the diagnosis text onto the four fault families by keyword evidence and
checks whether the top family matches what the twin actually injected — an honest,
automated accuracy signal (Gemma never sees the ground truth).
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from api_client import analyze
from faults import IncidentCapture, run_scenario
from incident import capture_to_incident, image_data_url

# Characteristic vocabulary for each fault family (lowercased substrings).
FAULT_KEYWORDS = {
    "slip": ["slip", "grip", "grasp", "dropped", "drop ", "lost the part", "fell", "release", "payload"],
    "jam": ["jam", "stall", "stuck", "conveyor", "belt", "over-current", "overcurrent", "motor current", "indexing"],
    "misclassify": ["misclassif", "classifier", "vision", "confidence", "threshold", "false accept",
                    "quality escape", "defect", "inspection", "re-inspect"],
    "collision": ["collision", "keep-out", "keep out", "safety zone", "human", "operator zone",
                  "breach", "light curtain", "clearance"],
}


@dataclass
class DiagnosisScore:
    fault_id: str                 # the injected ground-truth fault
    predicted: Optional[str]      # the family the diagnosis points to
    correct: bool
    evidence: dict                # per-family keyword hit counts
    diagnosed_root_cause: str
    confidence_level: str


def classify_diagnosis(text: str) -> tuple[Optional[str], dict]:
    """Map free-text diagnosis onto a fault family by weighted keyword evidence."""
    low = text.lower()
    scores = {fam: sum(low.count(kw) for kw in kws) for fam, kws in FAULT_KEYWORDS.items()}
    best = max(scores, key=scores.get)
    return (best if scores[best] > 0 else None), scores


def score_diagnosis(analysis: dict, cap: IncidentCapture) -> DiagnosisScore:
    result = (analysis or {}).get("result", {}) or {}
    report = result.get("finalReport", {}) or {}
    root = report.get("mostLikelyRootCause", "") or ""
    hyps = result.get("hypotheses", []) or []
    top_hyp = hyps[0].get("hypothesis", "") if hyps else ""
    summary = report.get("executiveSummary", "") or ""
    text = " ".join([root, top_hyp, summary])

    predicted, evidence = classify_diagnosis(text)
    return DiagnosisScore(
        fault_id=cap.fault_id,
        predicted=predicted,
        correct=(predicted == cap.fault_id),
        evidence=evidence,
        diagnosed_root_cause=root or top_hyp or "(none returned)",
        confidence_level=report.get("confidenceLevel", "?"),
    )


def diagnose_fault(
    fault_id: str,
    mode: str = "live",
    base_url: Optional[str] = None,
    warmup_s: float = 2.0,
    seed: int = 0,
) -> tuple[IncidentCapture, dict, DiagnosisScore]:
    """Run steps 1-4 for one fault: inject -> capture -> package -> diagnose -> score."""
    cap = run_scenario(fault_id, warmup_s=warmup_s, seed=seed, render=True)
    incident = capture_to_incident(cap)
    analysis = analyze(incident, image_data_url(cap.image), base_url=base_url, mode=mode)
    score = score_diagnosis(analysis, cap)
    return cap, analysis, score

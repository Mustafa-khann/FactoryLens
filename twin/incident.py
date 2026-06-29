"""
Adapter: a twin IncidentCapture -> the FactoryLens `Incident` payload (+ image data URL).

This is step 3 of the loop — packaging what the cell observed into the exact shape the
existing FactoryLens diagnosis pipeline consumes. Critically, it serialises ONLY observable
telemetry: the hidden ground truth and each part's true class are withheld so the agents
must actually diagnose the fault rather than read the answer.
"""
from __future__ import annotations

import base64
import io
from typing import Optional

from cell import BIN, PICK, SAFETY, SAFETY_RADIUS, CellState
from faults import IncidentCapture


def image_data_url(img) -> Optional[str]:
    """PNG-encode a rendered RGB frame as a data URL the analyze route accepts."""
    if img is None:
        return None
    try:
        from PIL import Image

        buf = io.BytesIO()
        Image.fromarray(img).save(buf, format="PNG")
        return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")
    except Exception:
        return None


def _parts_observable(state: CellState) -> str:
    rows = []
    for p in state.parts:
        loc = "in_bin" if p["in_bin"] else ("ON_FLOOR" if p["on_floor"] else "on_belt/in_transit")
        rows.append(f"    - {p['id']}: location={loc} pos={p['pos']}")
    return "\n".join(rows)


def _classifier_observable(state: CellState) -> str:
    rows = []
    for pid, label in state.classifier.items():
        conf = state.classifier_confidence.get(pid, 0.0)
        flag = "  <-- BELOW ACCEPT THRESHOLD" if conf < state.classifier_threshold else ""
        rows.append(f"    - {pid}: predicted={label} confidence={conf}{flag}")
    return "\n".join(rows)


def _telemetry_block(title: str, state: CellState) -> str:
    return "\n".join([
        f"[{title} @ t={state.t}s]",
        f"  cycle={state.cycle} phase={state.phase} held_part={state.held_part}",
        f"  joint_pos={state.joint_pos}",
        f"  joint_target={state.joint_target}",
        f"  actuator_torque_Nm={state.actuator_force}",
        f"  conveyor: belt_speed={state.belt_speed} m/s  motor_current={state.belt_motor_current} A (nominal ~1.8 A)",
        f"  gripper_pos={state.gripper_pos}",
        f"  gripper_to_pick={state.gripper_to_pick} m  gripper_to_human_zone={state.gripper_to_safety} m"
        f"  (keep_out_radius={state.safety_radius} m, breached={state.safety_breached})",
        "  parts:",
        _parts_observable(state),
        "  vision_classifier:",
        _classifier_observable(state),
    ])


def build_logs(cap: IncidentCapture) -> str:
    """Synthesise a controller log: clean baseline, the injection marker, and the incident telemetry."""
    return "\n".join([
        "FactoryLens digital-twin controller log (UR5e pick-and-place cell).",
        "Telemetry is from the live MuJoCo simulation. Diagnose the most likely cause from the evidence below.",
        "",
        _telemetry_block("BASELINE (nominal, pre-event)", cap.baseline),
        "",
        f"[EVENT @ t={cap.arm_time}s] anomaly began; controller flagged a deviation from nominal.",
        "",
        _telemetry_block("INCIDENT (at detection)", cap.incident),
    ])


def build_config() -> str:
    return "\n".join([
        "Cell configuration:",
        f"  robot: Universal Robots UR5e (6-DOF), position-controlled pick-and-place",
        f"  cycle phases: home -> reach -> lift -> transfer -> place",
        f"  pick_point(xyz)={list(PICK.round(3))}  bin_center(xyz)={list(BIN.round(3))}",
        f"  human_keep_out: center={list(SAFETY.round(3))} radius={SAFETY_RADIUS} m",
        f"  conveyor: nominal belt motor current ~1.8 A; stall protection trips on sustained over-current",
        f"  vision: defect classifier, accept threshold 0.85 (calls below are meant to be re-inspected)",
    ])


def build_timeline(cap: IncidentCapture) -> list:
    events = []
    for item in cap.timeline:
        sev = item.get("severity", "info")
        events.append({
            "timestamp": f"t+{item['t']}s",
            "event": item["event"],
            "source": "twin",
            "severity": sev if sev in ("info", "warning", "critical") else "info",
        })
    return events


def capture_to_incident(cap: IncidentCapture) -> dict:
    """Build the FactoryLens Incident payload (observable evidence only — no ground-truth leak)."""
    return {
        "id": f"twin-{cap.fault_id}-{int(cap.incident.t)}",
        "incidentTitle": cap.symptom.title,
        "machineType": "Universal Robots UR5e pick-and-place cell",
        "severity": cap.symptom.severity,
        "logs": build_logs(cap),
        "config": build_config(),
        "maintenanceNotes": "UR5e within service interval; conveyor drive serviced last quarter. "
                            "No open work orders on the cell at time of event.",
        "operatorNotes": cap.symptom.operator_note,
        "timestampedEvents": build_timeline(cap),
    }

"""
FactoryLens digital twin — runnable entry point.

Runs the real UR5e factory cell, optionally injects an adversarial fault, and writes a
rendered frame plus a JSON capture of the incident (baseline + incident state, ground
truth, and timeline). This is the substrate the rest of the loop builds on: multi-agent
diagnosis, recovery, closed-loop evaluation, and a deployment-readiness report all operate
on the state and image this produces.

Usage:
    python run.py                         # nominal cycle
    python run.py --fault slip --out out  # inject a fault and capture the incident
    python run.py --fault collision
"""
from __future__ import annotations

import argparse
import dataclasses
import json
from pathlib import Path

from cell import FactoryCell
from faults import FAULTS, run_scenario


def _save_image(img, path: Path):
    try:
        from PIL import Image

        Image.fromarray(img).save(path)
        print(f"saved {path}")
    except Exception as exc:  # pragma: no cover - best-effort
        print(f"render skipped: {exc}")


def main():
    ap = argparse.ArgumentParser(description="Run the FactoryLens UR5e digital twin.")
    ap.add_argument("--fault", choices=sorted(FAULTS), help="inject an adversarial fault")
    ap.add_argument("--seconds", type=float, default=6.0, help="sim seconds for the nominal run")
    ap.add_argument("--warmup", type=float, default=2.0, help="nominal seconds before injecting the fault")
    ap.add_argument("--out", type=str, default="out", help="output directory")
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    if args.fault:
        cap = run_scenario(args.fault, warmup_s=args.warmup, seed=args.seed)
        if cap.image is not None:
            _save_image(cap.image, out / f"incident_{args.fault}.png")
        payload = {
            "fault_id": cap.fault_id,
            "manifested": cap.manifested,
            "arm_time": cap.arm_time,
            "detect_time": cap.detect_time,
            "ground_truth": dataclasses.asdict(cap.ground_truth),
            "baseline": dataclasses.asdict(cap.baseline),
            "incident": dataclasses.asdict(cap.incident),
            "timeline": cap.timeline,
        }
        (out / f"incident_{args.fault}.json").write_text(json.dumps(payload, indent=2))
        print(f"saved {out / f'incident_{args.fault}.json'}")
        inc = cap.incident
        print(f"[{cap.fault_id}] manifested={cap.manifested} @ {cap.detect_time}s — "
              f"phase={inc.phase} belt={inc.belt_speed}m/s current={inc.belt_motor_current}A "
              f"to_safety={inc.gripper_to_safety}m breach={inc.safety_breached}")
        return

    cell = FactoryCell(seed=args.seed)
    cell.run(args.seconds)
    state = cell.snapshot()
    _save_image(cell.render(640, 480), out / "frame.png")
    (out / "state.json").write_text(json.dumps(dataclasses.asdict(state), indent=2))
    print(f"saved {out / 'state.json'}")
    print(f"t={state.t}s phase={state.phase} cycle={state.cycle} "
          f"parts_in_bin={sum(p['in_bin'] for p in state.parts)}")
    cell.close()


if __name__ == "__main__":
    main()

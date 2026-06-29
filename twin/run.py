"""
FactoryLens digital twin — runnable entry point.

Runs the real UR5e factory cell, optionally injects an adversarial fault, and writes a
rendered frame plus a JSON capture of the incident (baseline + incident state, ground
truth, and timeline). This is the substrate the rest of the loop builds on: multi-agent
diagnosis, recovery, closed-loop evaluation, and a deployment-readiness report all operate
on the state and image this produces.

Usage:
    python run.py                              # nominal cycle
    python run.py --fault slip --out out       # inject a fault and capture the incident
    python run.py --fault collision --diagnose # also run it through the FactoryLens agents
    python run.py --diagnose-all               # diagnose all four faults, print a scorecard

`--diagnose` calls the FactoryLens API ($FACTORYLENS_API, default http://localhost:3000);
run `npm run dev` first and set CEREBRAS_API_KEY for a live diagnosis.
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


def _print_diagnosis(cap, analysis, score):
    gt = cap.ground_truth
    mark = "✓ CORRECT" if score.correct else "✗ missed"
    print(f"\n──── {cap.fault_id.upper()} ────")
    print(f"  symptom shown : {cap.symptom.title}")
    print(f"  Gemma's call  : {score.diagnosed_root_cause[:110]}")
    print(f"  → fault family: {score.predicted}  [{mark}]  (confidence: {score.confidence_level})")
    print(f"  ground truth  : {gt.summary[:110]}")
    print(f"  evidence      : {score.evidence}")


def _diagnose(fault_id, mode, base_url):
    from diagnose import diagnose_fault

    cap, analysis, score = diagnose_fault(fault_id, mode=mode, base_url=base_url)
    _print_diagnosis(cap, analysis, score)
    return score


def main():
    ap = argparse.ArgumentParser(description="Run the FactoryLens UR5e digital twin.")
    ap.add_argument("--fault", choices=sorted(FAULTS), help="inject an adversarial fault")
    ap.add_argument("--diagnose", action="store_true", help="run the injected fault through the FactoryLens agents")
    ap.add_argument("--diagnose-all", action="store_true", help="diagnose all four faults and print a scorecard")
    ap.add_argument("--recover", action="store_true", help="run the full loop (diagnose + recover + closed-loop score) for --fault")
    ap.add_argument("--recover-all", action="store_true", help="run the full loop for all four faults and score recoveries")
    ap.add_argument("--policy", choices=["agent", "oracle"], default="agent", help="recovery action selection")
    ap.add_argument("--mode", choices=["live", "demo"], default="live", help="diagnosis/recovery mode")
    ap.add_argument("--api", type=str, default=None, help="FactoryLens API base URL (overrides $FACTORYLENS_API)")
    ap.add_argument("--seconds", type=float, default=6.0, help="sim seconds for the nominal run")
    ap.add_argument("--warmup", type=float, default=2.0, help="nominal seconds before injecting the fault")
    ap.add_argument("--out", type=str, default="out", help="output directory")
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    if args.diagnose_all:
        scores = [_diagnose(fid, args.mode, args.api) for fid in sorted(FAULTS)]
        hits = sum(s.correct for s in scores)
        print(f"\n=== diagnosis scorecard: {hits}/{len(scores)} faults correctly identified ===")
        return

    if args.recover_all or (args.fault and args.recover):
        from loop import run_loop

        faults = sorted(FAULTS) if args.recover_all else [args.fault]
        total = 0.0
        for fid in faults:
            r = run_loop(fid, mode=args.mode, policy=args.policy, base_url=args.api, render=bool(args.out))
            o = r.outcome
            total += o.score
            print(f"\n──── {fid.upper()} ────")
            print(f"  diagnosis   : {r.diagnosed_root_cause[:90]}  [{'✓' if r.diagnosis_correct else '✗'}]")
            print(f"  recovery    : {o.action_id}  ({r.recovery_rationale[:70]})")
            print(f"  applied → outcome: success={o.success} safe={o.safety_ok} score={o.score}")
            print(f"  physical    : {o.detail}")
            print(f"  ground truth: {r.ground_truth[:90]}")
            if args.out and o.image is not None:
                _save_image(o.image, out / f"recovery_{fid}.png")
        if len(faults) > 1:
            print(f"\n=== closed-loop recovery score: {total:.1f}/{len(faults)} ===")
        return

    if args.fault and args.diagnose:
        _diagnose(args.fault, args.mode, args.api)
        return

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

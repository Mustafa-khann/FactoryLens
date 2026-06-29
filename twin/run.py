"""
FactoryLens digital twin — runnable entry point.

Runs the real UR5e factory cell through its pick-and-place cycle and writes a rendered
frame plus a JSON state snapshot. This is the substrate the adversarial loop builds on:
fault injection, multi-agent diagnosis, recovery, evaluation, and a deployment-readiness
report all operate on the state and image this produces.

Usage:
    python run.py --seconds 6 --out out/
"""
from __future__ import annotations

import argparse
import dataclasses
import json
from pathlib import Path

from cell import FactoryCell


def main():
    ap = argparse.ArgumentParser(description="Run the FactoryLens UR5e digital twin.")
    ap.add_argument("--seconds", type=float, default=6.0, help="sim seconds to run")
    ap.add_argument("--out", type=str, default="out", help="output directory")
    ap.add_argument("--width", type=int, default=640)
    ap.add_argument("--height", type=int, default=480)
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    cell = FactoryCell(seed=args.seed)
    cell.run(args.seconds)
    state = cell.snapshot()

    # render
    try:
        from PIL import Image

        Image.fromarray(cell.render(args.width, args.height)).save(out / "frame.png")
        print(f"saved {out/'frame.png'}")
    except Exception as exc:  # pragma: no cover - rendering is best-effort on the CLI
        print(f"render skipped: {exc}")

    (out / "state.json").write_text(json.dumps(dataclasses.asdict(state), indent=2))
    print(f"saved {out/'state.json'}")
    print(
        f"t={state.t}s  phase={state.phase}  cycle={state.cycle}  "
        f"held={state.held_part}  parts_in_bin={sum(p['in_bin'] for p in state.parts)}"
    )
    cell.close()


if __name__ == "__main__":
    main()

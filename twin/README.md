# FactoryLens Digital Twin (MuJoCo + real UR5e)

A physics-accurate factory work-cell that the FactoryLens agents diagnose and recover.
The robot is the **real Universal Robots UR5e** from
[MuJoCo Menagerie](https://github.com/google-deepmind/mujoco_menagerie) — validated
meshes, inertias, and tuned actuators — running a pick-and-place cycle off a conveyor.

This is the simulation substrate for the **Adversarial Factory Digital Twin** loop:

```
1. UR5e factory cell runs a pick-and-place cycle      (cell.py)            ✅
2. A fault is injected: slip · jam · misclassify · collision  (faults.py)  ✅
3. Gemma reads the cell state + rendered image         (incident.py)       ✅
4. Multiple agents diagnose the cause                  (diagnose.py → lib/) ✅
5. A recovery agent proposes an action                 (recovery.py → /api/recover)  ✅
6. The action is applied back in the sim and scored    (recovery.py — closed loop)   ✅
7. A report agent writes a deployment-readiness note   [next]
```

## What works today

- `cell.py` — the real UR5e cell. Scripted joint-space pick/place cycle on top of real
  MuJoCo dynamics; grasped parts are carried by the flange and fall under real gravity
  when released or slipped. `snapshot()` exposes everything an agent needs (joint angles,
  actuator torques, part poses, gripper-to-pick / gripper-to-human distances, belt speed,
  conveyor motor current, classifier vs. true class).
- `faults.py` — adversarial fault injection, one per failure family. Each perturbs the
  cycle physically and carries a hidden `GroundTruth` (real cause + betraying signals +
  what a correct recovery must achieve) used only to score the agents:
  - **slip** — gripper loses the part mid-transfer; it falls to the floor.
  - **jam** — belt stalls, drive current climbs above nominal, parts stop indexing.
  - **misclassify** — vision passes a defective part as good (quality escape).
  - **collision** — a trajectory error drives the arm into the human keep-out zone.
- `robots/ur5e/factory_cell.xml` — the cell scene: UR5e + conveyor + bin + parts + a human
  safety keep-out zone, placed in the arm's measured reachable workspace.
- Headless rendering via OSMesa (no GPU needed).

- `incident.py` — packages a capture into the FactoryLens `Incident` shape using **only
  observable telemetry** (the hidden ground truth and each part's true class are withheld,
  so the agents must actually diagnose). The rendered frame becomes a PNG data URL.
- `api_client.py` / `diagnose.py` — POST the incident to the existing FactoryLens analyze
  pipeline (Vision + Synthesis + Skeptic), then score Gemma's call against the hidden
  ground truth by fault family. Gemma never sees the answer.

```bash
python run.py --fault collision --out out          # inject a fault, capture incident + frame
python run.py --fault collision --diagnose          # also run it through the agents
python run.py --diagnose-all                        # diagnose all four, print a scorecard
```

- `recovery.py` — the recovery action space + **closed-loop evaluator**. A chosen action is
  applied back in the live sim (the arm retrieves a dropped part via IK, the belt drive is
  cut, a suspect part is moved to quarantine, a breaching path is replanned) and scored on
  **physics**: did the fault clear, and did the recovery stay clear of the human zone? It
  refuses to reward a plausible-but-wrong recovery (e.g. re-grasping when the belt is
  jammed scores 0).
- `loop.py` — the full loop on one shared sim: run_to_fault → diagnose → recovery agent
  picks an action (`/api/recover`) → apply & score.

```bash
python run.py --recover --fault jam        # full loop for one fault
python run.py --recover-all                # full loop for all four, closed-loop scorecard
python run.py --recover-all --policy oracle # use the known-correct action (no recovery agent)
```

Diagnosis and recovery call `$FACTORYLENS_API` (default `http://localhost:3000`). For a
**live** run, `npm run dev` in the repo root with `CEREBRAS_API_KEY` set. `--mode demo`
exercises the full plumbing without a key (heuristic agent + sample diagnosis); the
closed-loop physical scoring is real in both modes.

## Setup

```bash
pip install -r requirements.txt
apt-get install -y libosmesa6        # CPU offscreen renderer
python run.py --seconds 6 --out out  # writes out/frame.png + out/state.json
```

## Attribution

The UR5e model under `robots/ur5e/` is from Google DeepMind's MuJoCo Menagerie and the
ROS-Industrial Consortium, redistributed under their original license — see
`robots/ur5e/LICENSE`.

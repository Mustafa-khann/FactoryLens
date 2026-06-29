# FactoryLens Digital Twin (MuJoCo + real UR5e)

A physics-accurate factory work-cell that the FactoryLens agents diagnose and recover.
The robot is the **real Universal Robots UR5e** from
[MuJoCo Menagerie](https://github.com/google-deepmind/mujoco_menagerie) — validated
meshes, inertias, and tuned actuators — running a pick-and-place cycle off a conveyor.

This is the simulation substrate for the **Adversarial Factory Digital Twin** loop:

```
1. UR5e factory cell runs a pick-and-place cycle      (cell.py)
2. A fault is injected: slip · jam · misclassification · collision-risk   [next]
3. Gemma reads the cell state + rendered image         [next]
4. Multiple agents diagnose the cause                  (reuses lib/ pipeline)
5. A recovery agent proposes an action                 [next]
6. The action is applied back in the sim and scored    [next — closed loop]
7. A report agent writes a deployment-readiness note   [next]
```

## What works today

- `cell.py` — the real UR5e cell. Scripted joint-space pick/place cycle on top of real
  MuJoCo dynamics; grasped parts are carried by the flange and fall under real gravity
  when released or slipped. `snapshot()` exposes everything an agent needs (joint angles,
  actuator torques, part poses, gripper-to-pick / gripper-to-human distances, belt speed,
  classifier vs. true class).
- `robots/ur5e/factory_cell.xml` — the cell scene: UR5e + conveyor + bin + parts + a human
  safety keep-out zone, placed in the arm's measured reachable workspace.
- Headless rendering via OSMesa (no GPU needed).

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

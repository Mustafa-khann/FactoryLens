import type { Incident, IncidentSeverity, TimelineEvent } from "../types";
import { getModel, type FailureMode, type SimModel } from "./models";

interface SimulationIncidentOptions {
  modelId: string;
  failureIds: string[];
  telemetry?: number[];
  simTime?: number;
}

const pad = (value: number) => value.toString().padStart(2, "0");
const simTimestamp = (seconds: number, offset = 0) => {
  const totalMs = Math.max(0, Math.round((seconds + offset) * 1000));
  const wholeSeconds = Math.floor(totalMs / 1000);
  const ms = totalMs % 1000;
  return `T+${pad(Math.floor(wholeSeconds / 60))}:${pad(wholeSeconds % 60)}.${ms.toString().padStart(3, "0")}`;
};

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

function faultRootCause(model: SimModel, failure: FailureMode) {
  if (model.id === "arm") {
    if (failure.id === "elbow-gain-loss") return "Elbow actuator gain loss causing sag and following error.";
    if (failure.id === "shoulder-friction") return "Shoulder bearing friction spike causing joint resistance and position error.";
    if (failure.id === "wrist-damping-loss") return "Wrist damping loss causing oscillation around the commanded pose.";
  }
  if (model.id === "conveyor") {
    if (failure.id === "belt-slip") return "Roller surface contamination causing traction loss and stalled transport.";
    if (failure.id === "driveline-seizure") return "Drive-line bearing seizure causing roller slowdown, torque rise, and line stop.";
  }
  if (model.id === "gripper") {
    if (failure.id === "grip-gain-loss") return "Grip actuator gain loss causing clamp force collapse and part drop.";
    if (failure.id === "pad-contamination") return "Jaw pad contamination causing friction loss and part slip.";
  }
  return `${failure.label} causing abnormal machine response.`;
}

function faultLogRows(model: SimModel, failures: FailureMode[], t: number) {
  return failures.flatMap((failure, index) => {
    const base = index * 0.35;
    if (model.id === "arm") {
      if (failure.id === "elbow-gain-loss") {
        return [
          `${simTimestamp(t, base + 0.12)} SIM_FAULT fault_id=elbow-gain-loss label="Elbow actuator gain loss"`,
          `${simTimestamp(t, base + 0.28)} ROBOT_TELEMETRY elbow_position_error=46.0deg elbow_actuator_force=low status=following_error`,
          `${simTimestamp(t, base + 0.45)} PLC_ALARM protective_stop reason=ELBOW_FOLLOWING_ERROR`,
        ];
      }
      if (failure.id === "wrist-damping-loss") {
        return [
          `${simTimestamp(t, base + 0.12)} SIM_FAULT fault_id=wrist-damping-loss label="Wrist damping loss"`,
          `${simTimestamp(t, base + 0.28)} ROBOT_TELEMETRY wrist_rate=-3.3rad/s oscillation=high damping=lost`,
          `${simTimestamp(t, base + 0.45)} MOTION_WARNING wrist_chatter exceeded_nominal_band=true`,
        ];
      }
      return [
        `${simTimestamp(t, base + 0.12)} SIM_FAULT fault_id=shoulder-friction label="Shoulder bearing friction spike"`,
        `${simTimestamp(t, base + 0.28)} ROBOT_TELEMETRY shoulder_torque_drop=abnormal shoulder_position_error=11.3deg friction_estimate=high`,
        `${simTimestamp(t, base + 0.45)} PLC_ALARM protective_stop reason=SHOULDER_RESISTANCE`,
      ];
    }
    if (model.id === "conveyor") {
      if (failure.id === "belt-slip") {
        return [
          `${simTimestamp(t, base + 0.12)} SIM_FAULT fault_id=belt-slip label="Roller surface contamination"`,
          `${simTimestamp(t, base + 0.28)} CONVEYOR_TELEMETRY roller_rate=8.18rad/s crate_velocity=low traction=lost`,
          `${simTimestamp(t, base + 0.45)} LINE_WARNING transport_stall reason=ROLLER_SURFACE_CONTAMINATION`,
        ];
      }
      return [
        `${simTimestamp(t, base + 0.12)} SIM_FAULT fault_id=driveline-seizure label="Drive-line bearing seizure"`,
        `${simTimestamp(t, base + 0.28)} CONVEYOR_TELEMETRY roller_rate=1.20rad/s drive_torque=23.41Nm motor_current=high`,
        `${simTimestamp(t, base + 0.45)} PLC_ALARM line_stop reason=DRIVELINE_SEIZURE`,
      ];
    }
    if (failure.id === "grip-gain-loss") {
      return [
        `${simTimestamp(t, base + 0.12)} SIM_FAULT fault_id=grip-gain-loss label="Grip actuator gain loss"`,
        `${simTimestamp(t, base + 0.28)} GRIPPER_TELEMETRY grip_force_left=0.00N grip_force_right=0.00N part_height=0.07m`,
        `${simTimestamp(t, base + 0.45)} CELL_WARNING part_drop reason=CLAMP_FORCE_COLLAPSE`,
      ];
    }
    return [
      `${simTimestamp(t, base + 0.12)} SIM_FAULT fault_id=pad-contamination label="Jaw pad contamination"`,
      `${simTimestamp(t, base + 0.28)} GRIPPER_TELEMETRY jaw_closed=true grip_friction=low part_height=0.07m`,
      `${simTimestamp(t, base + 0.45)} CELL_WARNING part_slip reason=JAW_PAD_CONTAMINATION`,
    ];
  });
}

function telemetryRows(model: SimModel, telemetry: number[] | undefined, t: number) {
  if (!telemetry?.length) return [];
  const values = model.telemetry.map((channel, index) => `${channel.label}=${(telemetry[index] ?? 0).toFixed(2)}${channel.unit}`).join(" ");
  return [`${simTimestamp(t, 0.08)} SIM_TELEMETRY ${values}`];
}

function configFor(model: SimModel, failures: FailureMode[]) {
  return [
    "digital_twin:",
    `  model_id: ${model.id}`,
    `  model_label: ${model.label}`,
    "  runtime: mujoco_wasm",
    `  active_failures: ${failures.length ? failures.map((failure) => failure.id).join(", ") : "none"}`,
    "safety:",
    "  stop_on_protective_alarm: true",
    "  require_human_verification_before_restart: true",
    "telemetry:",
    ...model.telemetry.map((channel) => `  - ${channel.label} (${channel.unit})`),
  ].join("\n");
}

function eventsFromRows(rows: string[]): TimelineEvent[] {
  return rows.map((row) => {
    const [timestamp, ...rest] = row.split(" ");
    const event = rest.join(" ");
    const severity = /PLC_ALARM|protective_stop|line_stop|part_drop/i.test(row)
      ? "critical"
      : /FAULT|WARNING|abnormal|lost|stall|slip|error/i.test(row)
        ? "warning"
        : "info";
    return {
      timestamp,
      event,
      source: row.includes("SIM_FAULT") ? "MuJoCo fault injection" : row.includes("SIM_TELEMETRY") ? "MuJoCo telemetry" : "Digital twin",
      severity,
    };
  });
}

function healthyIncident(model: SimModel, telemetry: number[] | undefined, simTime: number): Incident {
  const t = Number.isFinite(simTime) ? simTime : 0;
  const rows = [
    `${simTimestamp(t, 0)} SIM_SELECTION model_id=${model.id} model="${model.label}" fault_status=none`,
    ...telemetryRows(model, telemetry, t),
    `${simTimestamp(t, 0.18)} SIM_HEALTH_CHECK state=nominal anomaly_score=0.00 active_failures=none`,
    `${simTimestamp(t, 0.32)} CONTROLLER_STATUS state=running_ok protective_stop=false`,
    `${simTimestamp(t, 0.48)} FACTORYLENS_NOTE no_active_fault_detected=true recommendation="continue monitoring"`,
  ];
  return {
    id: `simulation-${model.id}-healthy-${Date.now()}`,
    incidentTitle: `${model.label} nominal run`,
    machineType: model.label,
    severity: "low",
    logs: rows.join("\n"),
    config: configFor(model, []),
    maintenanceNotes: "No active failure is injected in the MuJoCo digital twin. Telemetry is within the expected nominal envelope for this demo run.",
    operatorNotes: "Operator selected the simulation with no injected error. The expected agent response is that the machine is healthy and should continue monitoring.",
    timestampedEvents: eventsFromRows(rows),
    hiddenGroundTruth: "No injected fault. The machine is operating nominally.",
    expectedRootCause: "No fault detected; simulation telemetry is nominal.",
  };
}

export function createSimulationIncident({ modelId, failureIds, telemetry, simTime = 0 }: SimulationIncidentOptions): Incident {
  const model = getModel(modelId);
  const failures = failureIds.map((id) => model.failures.find((failure) => failure.id === id)).filter((failure): failure is FailureMode => Boolean(failure));
  if (!failures.length) return healthyIncident(model, telemetry, simTime);

  const t = Number.isFinite(simTime) ? simTime : 0;
  const rows = [
    `${simTimestamp(t, 0)} SIM_SELECTION model_id=${model.id} model="${model.label}" fault_status=active`,
    ...telemetryRows(model, telemetry, t),
    ...faultLogRows(model, failures, t),
  ];
  const rootCause = failures.map((failure) => faultRootCause(model, failure)).join(" ");
  const title = `${model.label} ${failures.map((failure) => failure.label).join(" + ")}`;
  const severity: IncidentSeverity = failures.length > 1 || rows.some((row) => /PLC_ALARM|part_drop|line_stop/i.test(row)) ? "critical" : "high";

  return {
    id: `simulation-${model.id}-${slug(failures.map((failure) => failure.id).join("-"))}-${Date.now()}`,
    incidentTitle: title,
    machineType: model.label,
    severity,
    logs: rows.join("\n"),
    config: configFor(model, failures),
    maintenanceNotes: failures.map((failure) => `${failure.label}: ${failure.description}`).join("\n"),
    operatorNotes: "Fault was injected from the MuJoCo simulation. Agents should diagnose only from the emitted logs, telemetry, config, and notes.",
    timestampedEvents: eventsFromRows(rows),
    hiddenGroundTruth: rootCause,
    expectedRootCause: rootCause,
  };
}

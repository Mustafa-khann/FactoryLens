import type { Incident, IncidentSeverity, TimelineEvent } from "./types";

const severities: IncidentSeverity[] = ["medium", "high", "critical"];

const pad = (value: number) => value.toString().padStart(2, "0");

const time = (hour: number, minute: number, second: number, ms = 0) =>
  `${pad(hour)}:${pad(minute)}:${pad(second)}.${ms.toString().padStart(3, "0")}`;

export const demoIncidents: Incident[] = [
  {
    id: "demo-robotic-arm-j3",
    incidentTitle: "Robotic arm emergency stop during pick-and-place",
    machineType: "Robotic arm cell",
    severity: "critical",
    logs: [
      "09:41:12.204 CELL-07 cycle_start job=pick_place_A17",
      "09:41:13.118 ROBOT state=auto path_segment=approach_bin_3",
      "09:41:14.882 J3 motor_current=8.2A baseline=4.1A",
      "09:41:15.031 J3 torque_limit_warning threshold=85%",
      "09:41:15.217 servo_temp joint=J3 temp=71C baseline=54C",
      "09:41:15.420 position_error joint=J3 error=4.8deg max_allowed=2.0deg",
      "09:41:15.611 PLC_ALARM E_STOP_042 emergency_stop_triggered",
      "09:41:15.744 ROBOT fault_code=J3_FOLLOWING_ERROR motion_aborted=true",
    ].join("\n"),
    config: [
      "motion_profile:",
      "  max_speed_mps: 1.8",
      "  acceleration_mps2: 2.4",
      "  jerk_limit: 0.9",
      "joint_limits:",
      "  J3:",
      "    torque_warning_threshold: 0.85",
      "    max_position_error_deg: 2.0",
      "safety:",
      "  stop_on_following_error: true",
    ].join("\n"),
    maintenanceNotes: [
      "Operator reported vibration near joint 3 for two days.",
      "Technician noted slight grinding sound during high-speed moves.",
      "No gearbox inspection completed after last maintenance cycle.",
      "Last lubrication record for J3 is 46 days old.",
    ].join("\n"),
    operatorNotes: [
      "Failure happened during fast pick motion.",
      "Arm shook briefly before emergency stop.",
      "No visible collision with bin or fixture.",
    ].join("\n"),
    timestampedEvents: [
      { timestamp: "09:41:12.204", event: "Pick-and-place cycle started for job A17.", source: "Controller log", severity: "info" },
      { timestamp: "09:41:14.882", event: "J3 motor current doubled against baseline.", source: "Robot telemetry", severity: "warning" },
      { timestamp: "09:41:15.031", event: "J3 torque warning crossed configured threshold.", source: "Robot telemetry", severity: "warning" },
      { timestamp: "09:41:15.217", event: "J3 servo temperature rose 17C above baseline.", source: "Robot telemetry", severity: "warning" },
      { timestamp: "09:41:15.420", event: "Position error reached 4.8 degrees against 2.0 degree limit.", source: "Robot telemetry", severity: "critical" },
      { timestamp: "09:41:15.611", event: "PLC emergency stop triggered.", source: "PLC alarm", severity: "critical" },
      { timestamp: "09:41:15.744", event: "Robot reported J3 following error and aborted motion.", source: "Robot fault", severity: "critical" },
    ],
    hiddenGroundTruth: "Mechanical resistance or early gearbox/servo issue at joint 3, amplified by aggressive acceleration profile.",
    expectedRootCause: "J3 mechanical resistance or servo/gearbox degradation causing torque spike and following error.",
  },
  {
    id: "demo-conveyor-bay-2",
    incidentTitle: "Conveyor motor overheating after speed increase",
    machineType: "Conveyor line",
    severity: "high",
    logs: [
      "13:02:11 PLC_PARAM conveyor_speed changed 1.2m/s -> 1.8m/s user=maintenance",
      "13:04:26 motor_current bay=2 value=9.8A baseline=7.4A",
      "13:07:44 motor_current bay=2 value=12.9A baseline=7.4A",
      "13:09:02 thermal_warning motor_bay_2 temp=78C threshold=75C",
      "13:10:15 vibration_warning roller_cluster=R4 amplitude=high",
      "13:11:38 operator_note burning_smell_near_motor",
      "13:12:03 PLC_ALARM MOTOR_THERMAL_TRIP motor_bay_2",
      "13:12:08 line_state stopped reason=thermal_trip",
    ].join("\n"),
    config: [
      "conveyor:",
      "  speed_mps: 1.8",
      "  previous_speed_mps: 1.2",
      "  thermal_trip_c: 85",
      "  thermal_warning_c: 75",
      "motor_bay_2:",
      "  rated_current_a: 10.5",
      "  overload_trip_delay_s: 90",
    ].join("\n"),
    maintenanceNotes: [
      "Belt tension adjusted yesterday after reported slipping.",
      "No current baseline was captured after the tension change.",
      "Roller cluster R4 had previous vibration notes.",
      "Motor fan guard has visible dust buildup.",
    ].join("\n"),
    operatorNotes: [
      "Burning smell came from motor bay 2.",
      "Conveyor was running faster than usual.",
      "Belt appeared tighter than normal.",
    ].join("\n"),
    timestampedEvents: [
      { timestamp: "13:02:11", event: "Conveyor speed changed from 1.2 m/s to 1.8 m/s.", source: "PLC parameter log", severity: "info" },
      { timestamp: "13:04:26", event: "Motor bay 2 current rose to 9.8A versus 7.4A baseline.", source: "Motor telemetry", severity: "warning" },
      { timestamp: "13:07:44", event: "Motor bay 2 current exceeded rated current at 12.9A.", source: "Motor telemetry", severity: "critical" },
      { timestamp: "13:09:02", event: "Thermal warning crossed 75C threshold.", source: "PLC alarm", severity: "warning" },
      { timestamp: "13:10:15", event: "R4 roller cluster reported high vibration.", source: "Vibration monitor", severity: "warning" },
      { timestamp: "13:12:03", event: "Motor bay 2 thermal trip stopped the line.", source: "PLC alarm", severity: "critical" },
    ],
    hiddenGroundTruth: "Increased conveyor speed plus excessive belt tension or roller friction overloaded motor bay 2, causing current rise and thermal trip.",
    expectedRootCause: "Mechanical load increase after speed and belt tension changes caused motor overheating.",
  },
  {
    id: "demo-rover-localization",
    incidentTitle: "Autonomous rover localization failure",
    machineType: "Autonomous rover",
    severity: "high",
    logs: [
      "15:21:04 nav_state active localization_confidence=0.91",
      "15:21:33 gps_hdop=1.2 imu_yaw_rate=0.08 wheel_odom_velocity=1.1",
      "15:22:10 wheel_odom_velocity=1.2m/s imu_velocity=0.7m/s slip_estimate=0.31",
      "15:22:33 gps_hdop=4.8 gps_quality=degraded",
      "15:22:47 ekf_innovation position=2.8m threshold=1.0m",
      "15:23:01 localization_confidence=0.42",
      "15:23:08 planner_abort reason=pose_uncertainty_exceeded",
      "15:23:11 nav_state safe_stop",
    ].join("\n"),
    config: [
      "ekf:",
      "  wheel_odom_noise: 0.04",
      "  imu_noise: 0.02",
      "  gps_noise: 0.8",
      "  innovation_threshold_m: 1.0",
      "planner:",
      "  abort_on_pose_uncertainty: true",
      "  min_localization_confidence: 0.55",
    ].join("\n"),
    maintenanceNotes: [
      "Rover operated in dusty outdoor yard.",
      "Wheel slip visible during turns.",
      "Tires have moderate wear.",
      "GPS intermittently degraded near metal structures.",
      "No IMU recalibration performed after last firmware update.",
    ].join("\n"),
    operatorNotes: [
      "Rover drifted left before stopping.",
      "Dust cloud visible during acceleration.",
      "Failure happened near steel storage racks.",
    ].join("\n"),
    timestampedEvents: [
      { timestamp: "15:21:04", event: "Rover navigation active with high localization confidence.", source: "Navigation log", severity: "info" },
      { timestamp: "15:22:10", event: "Wheel odometry diverged from IMU velocity and slip estimate increased.", source: "Sensor fusion log", severity: "warning" },
      { timestamp: "15:22:33", event: "GPS quality degraded near steel storage area.", source: "GPS log", severity: "warning" },
      { timestamp: "15:22:47", event: "EKF position innovation exceeded configured threshold.", source: "EKF log", severity: "critical" },
      { timestamp: "15:23:01", event: "Localization confidence fell below planner minimum.", source: "Navigation log", severity: "critical" },
      { timestamp: "15:23:08", event: "Planner aborted because pose uncertainty was too high.", source: "Planner log", severity: "critical" },
    ],
    hiddenGroundTruth: "Wheel odometry drift under slip plus GPS degradation caused EKF pose uncertainty and planner abort.",
    expectedRootCause: "Sensor fusion failure from wheel slip and degraded GPS, with EKF noise parameters too optimistic.",
  },
];

interface Template {
  machineType: string;
  component: string;
  symptom: string;
  configClue: string;
  maintenanceClue: string;
  operatorClue: string;
  rootCause: string;
  graph: string[];
}

const generatedTemplates: Template[] = [
  {
    machineType: "Robotic arm",
    component: "J4 axis",
    symptom: "following error during fast transfer",
    configClue: "acceleration_mps2 raised after throughput tuning",
    maintenanceClue: "axis reported intermittent chatter during the prior shift",
    operatorClue: "arm shook during the outbound move",
    rootCause: "axis mechanical resistance amplified by aggressive motion tuning",
    graph: ["axis chatter", "current rise", "torque warning", "following error", "protective stop"],
  },
  {
    machineType: "Conveyor",
    component: "motor bay 3",
    symptom: "thermal trip under elevated line speed",
    configClue: "speed_mps increased without recapturing load baseline",
    maintenanceClue: "roller cluster had a deferred bearing inspection",
    operatorClue: "burning smell and belt squeal near drive end",
    rootCause: "excess mechanical load from belt tension or roller friction causing motor overload",
    graph: ["speed change", "load increase", "current rise", "thermal warning", "line stop"],
  },
  {
    machineType: "Autonomous rover",
    component: "localization stack",
    symptom: "planner abort on pose uncertainty",
    configClue: "EKF wheel odometry noise set lower than observed slip conditions",
    maintenanceClue: "tires show wear and IMU calibration is overdue",
    operatorClue: "vehicle drifted left near metal racks",
    rootCause: "sensor fusion instability from wheel slip and degraded GPS",
    graph: ["wheel slip", "GPS degradation", "EKF innovation spike", "confidence drop", "safe stop"],
  },
  {
    machineType: "Drone",
    component: "front-right motor",
    symptom: "attitude controller saturation",
    configClue: "current limit is close to hover load after payload change",
    maintenanceClue: "propeller has a small nick and motor bearing noise was noted",
    operatorClue: "drone yawed right before landing abort",
    rootCause: "thrust imbalance from motor or propeller degradation under added payload",
    graph: ["payload change", "motor current rise", "yaw correction", "controller saturation", "landing abort"],
  },
  {
    machineType: "CNC spindle",
    component: "spindle drive",
    symptom: "overload fault during roughing pass",
    configClue: "feed rate increased while tool wear compensation stayed unchanged",
    maintenanceClue: "tool has exceeded expected cutting hours",
    operatorClue: "cut sounded rough before the spindle fault",
    rootCause: "tool wear and aggressive feed rate causing spindle overload",
    graph: ["feed increase", "tool wear", "spindle load rise", "vibration", "drive fault"],
  },
  {
    machineType: "Packaging line",
    component: "seal jaw station",
    symptom: "seal quality faults followed by line stop",
    configClue: "dwell time reduced during throughput adjustment",
    maintenanceClue: "temperature sensor drift was suspected last week",
    operatorClue: "weak seals appeared on the right side of packs",
    rootCause: "heat transfer instability from short dwell time and sensor drift",
    graph: ["dwell reduction", "temperature variance", "weak seals", "reject spike", "line stop"],
  },
  {
    machineType: "Pump/motor system",
    component: "pump P-204",
    symptom: "cavitation alarm and motor overload",
    configClue: "low inlet pressure threshold was relaxed during commissioning",
    maintenanceClue: "strainer inspection is overdue",
    operatorClue: "pump noise changed from smooth hum to rattling",
    rootCause: "restricted inlet flow causing cavitation and elevated motor load",
    graph: ["restricted inlet", "pressure drop", "cavitation", "current rise", "protective trip"],
  },
];

const pick = <T,>(items: T[]) => items[Math.floor(Math.random() * items.length)];

const createEvents = (startHour: number, startMinute: number, template: Template): TimelineEvent[] => {
  const t0 = time(startHour, startMinute, 4);
  const t1 = time(startHour, startMinute, 36);
  const t2 = time(startHour, startMinute + 1, 18);
  const t3 = time(startHour, startMinute + 1, 42);
  const t4 = time(startHour, startMinute + 2, 5);
  return [
    { timestamp: t0, event: `${template.machineType} entered automatic cycle; ${template.component} nominal.`, source: "Controller log", severity: "info" },
    { timestamp: t1, event: `${template.configClue}.`, source: "Config/change log", severity: "info" },
    { timestamp: t2, event: `${template.component} reported ${template.symptom}.`, source: "Telemetry", severity: "warning" },
    { timestamp: t3, event: `${template.operatorClue}.`, source: "Operator note", severity: "warning" },
    { timestamp: t4, event: `Protective stop triggered after ${template.component} exceeded operating envelope.`, source: "PLC alarm", severity: "critical" },
  ];
};

export function generateSyntheticIncident(machineType?: string): Incident {
  const normalized = machineType?.trim().toLowerCase();
  const matchingTemplate = generatedTemplates.find((template) =>
    normalized ? template.machineType.toLowerCase().includes(normalized) || normalized.includes(template.machineType.toLowerCase()) : false,
  );
  const template = matchingTemplate ?? pick(generatedTemplates);
  const startHour = 7 + Math.floor(Math.random() * 10);
  const startMinute = 5 + Math.floor(Math.random() * 45);
  const currentA = (8 + Math.random() * 7).toFixed(1);
  const baselineA = (4 + Math.random() * 3).toFixed(1);
  const tempC = 68 + Math.floor(Math.random() * 20);
  const severity = pick(severities);
  const events = createEvents(startHour, startMinute, template);
  const id = `synthetic-${template.machineType.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`;

  return {
    id,
    incidentTitle: `${template.machineType} ${template.symptom}`,
    machineType: template.machineType,
    severity,
    logs: [
      `${events[0].timestamp} SYSTEM state=auto component="${template.component}"`,
      `${events[1].timestamp} CONFIG_CHANGE note="${template.configClue}"`,
      `${events[2].timestamp} TELEMETRY component="${template.component}" current=${currentA}A baseline=${baselineA}A temp=${tempC}C`,
      `${events[3].timestamp} OPERATOR_NOTE "${template.operatorClue}"`,
      `${events[4].timestamp} PLC_ALARM protective_stop component="${template.component}" reason="${template.symptom}"`,
    ].join("\n"),
    config: [
      "operating_profile:",
      `  component: ${template.component}`,
      "  auto_stop_on_fault: true",
      `  risk_note: ${template.configClue}`,
      "limits:",
      "  current_warning_ratio: 1.35",
      "  thermal_warning_c: 75",
      "  stop_on_envelope_violation: true",
    ].join("\n"),
    maintenanceNotes: [
      template.maintenanceClue,
      "No post-change baseline was captured for the affected subsystem.",
      "Inspection record is incomplete for the current maintenance interval.",
    ].join("\n"),
    operatorNotes: [
      template.operatorClue,
      "Failure occurred shortly after the equipment entered a high-load portion of the cycle.",
      "No manual override was active at the time of the protective stop.",
    ].join("\n"),
    timestampedEvents: events,
    hiddenGroundTruth: `${template.rootCause}; contributing configuration clue: ${template.configClue}.`,
    expectedRootCause: template.rootCause,
  };
}

export function getGraphSeed(incident: Incident): string[] {
  if (incident.id === "demo-robotic-arm-j3") {
    return ["J3 vibration", "motor current spike", "torque warning", "position deviation", "emergency stop", "servo/gearbox degradation"];
  }
  if (incident.id === "demo-conveyor-bay-2") {
    return ["speed increase", "belt tension", "current rise", "thermal warning", "R4 vibration", "motor thermal trip"];
  }
  if (incident.id === "demo-rover-localization") {
    return ["wheel slip", "GPS degradation", "EKF innovation", "confidence drop", "planner abort", "safe stop"];
  }
  const template = generatedTemplates.find((item) => incident.machineType.toLowerCase().includes(item.machineType.toLowerCase()));
  if (template) return template.graph;
  return ["evidence change", "signal anomaly", "protective alarm", "stop event", "candidate root cause"];
}

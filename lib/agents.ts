import type { ChatMessage } from "./cerebras";
import type { AgentDisplay, AgentProfile, Incident, PriorIncidentContext } from "./types";

export const AGENT_PROFILES: AgentProfile[] = [
  {
    id: "log-forensics",
    name: "Log Forensics Agent",
    role: "Reads logs, extracts timestamps, alarms, anomalies, signal changes, and causal clues.",
  },
  {
    id: "vision-inspector",
    name: "Vision Inspector Agent",
    role: "Uses image input when present; otherwise lists the visual evidence the field team must collect.",
  },
  {
    id: "controls-engineer",
    name: "Controls Engineer Agent",
    role: "Analyzes robot, PLC, motion, control, threshold, interlock, and configuration issues.",
  },
  {
    id: "maintenance-engineer",
    name: "Maintenance Engineer Agent",
    role: "Interprets physical symptoms, wear, overheating, vibration, wiring, maintenance gaps, and obstructions.",
  },
  {
    id: "root-cause",
    name: "Root Cause Agent",
    role: "Generates ranked root-cause hypotheses with evidence for, evidence against, and falsification tests.",
  },
  {
    id: "skeptic",
    name: "Skeptic Agent",
    role: "Attacks weak conclusions, missing evidence, overconfidence, and causal-order mistakes.",
  },
  {
    id: "safety-officer",
    name: "Safety Officer Agent",
    role: "Flags hazards, lockout/tagout needs, unsafe actions, and human escalation criteria.",
  },
  {
    id: "incident-commander",
    name: "Incident Commander Agent",
    role: "Produces the final safety-aware repair decision.",
  },
];

export function createEmptyAgents(): AgentDisplay[] {
  return AGENT_PROFILES.map((agent) => ({
    ...agent,
    status: "waiting",
    summary: "",
    keyFindings: [],
  }));
}

/** Render past similar incidents as priors the agents may use, while making clear current evidence overrides them. */
function formatPriorIncidents(priorIncidents?: PriorIncidentContext[]): string {
  if (!priorIncidents || priorIncidents.length === 0) {
    return [
      "Site incident history:",
      "No similar past incidents are on record for this machine. Treat this as a first-occurrence pattern.",
    ].join("\n");
  }
  const lines = priorIncidents.map((prior, index) => {
    const confirmed = prior.confirmedRootCause
      ? ` CONFIRMED root cause (resolved by a technician): ${prior.confirmedRootCause}.`
      : "";
    const fix = prior.resolvedFix ? ` Fix that worked: ${prior.resolvedFix}.` : "";
    return `${index + 1}. "${prior.title}" on a ${prior.machineType} (severity ${prior.severity}). Previously diagnosed as: ${prior.diagnosedRootCause}.${confirmed}${fix}`;
  });
  return [
    "Site incident history (similar past failures retrieved from FactoryLens memory):",
    ...lines,
    "",
    "How to use this history:",
    "- Treat these as PRIORS, not ground truth. The current evidence always overrides them.",
    "- If a prior with a CONFIRMED resolution closely matches the current evidence, surface it as a leading hypothesis and reference it, but still demand the confirming test before recommending the same fix.",
    "- If the current evidence contradicts the priors, say so explicitly rather than forcing a match.",
  ].join("\n");
}

function formatIncidentEvidence(
  incident: Incident,
  imageDataUrl?: string,
  visionFindings?: string[],
  priorIncidents?: PriorIncidentContext[],
) {
  return [
    "Run a full FactoryLens multi-agent investigation.",
    "",
    "FactoryLens positioning:",
    "FactoryLens is an AI War Room for Industrial Failures. It turns incident evidence into a timeline, evidence graph, ranked root causes, missing data requests, safety warnings, and a final Incident Commander repair decision.",
    "",
    "Synthetic data note:",
    "These are synthetic industrial incidents modeled after real robotics, PLC, and field-maintenance failure patterns.",
    "",
    formatPriorIncidents(priorIncidents),
    "",
    "Hard rules:",
    "- Be technical and concise.",
    "- Cite supplied evidence.",
    "- Mark uncertainty.",
    "- Separate observation from inference.",
    "- Do not hallucinate.",
    "- Do not invent sensor readings, image details, timestamps, or maintenance history.",
    "- Do not provide unsafe repair instructions.",
    "- Do not sound like a generic chatbot.",
    "- Treat protective trips and emergency stops as safety signals, not nuisances to bypass.",
    "",
    "Agent roster:",
    AGENT_PROFILES.map((agent) => `- ${agent.id}: ${agent.name} - ${agent.role}`).join("\n"),
    "",
    "Vision Inspector findings:",
    visionFindings && visionFindings.length
      ? `The Vision Inspector agent already analyzed the supplied image. Treat these visual findings as evidence and reflect them in the Vision Inspector agent entry:\n${visionFindings
          .map((finding) => `- ${finding}`)
          .join("\n")}`
      : imageDataUrl
        ? "An image is attached after this text. The Vision Inspector Agent must inspect only visible evidence in that image and tie visual observations to uncertainty."
        : "No image is attached. The Vision Inspector Agent must explicitly state that no image was provided and list useful visual evidence to collect.",
    "",
    "Incident evidence:",
    `Title: ${incident.incidentTitle}`,
    `Machine type: ${incident.machineType}`,
    `Severity: ${incident.severity}`,
    `Image supplied: ${imageDataUrl ? incident.imageName || "yes" : "no"}`,
    "",
    "Logs:",
    incident.logs || "[empty]",
    "",
    "Config/code:",
    incident.config || "[empty]",
    "",
    "Maintenance notes:",
    incident.maintenanceNotes || "[empty]",
    "",
    "Operator notes:",
    incident.operatorNotes || "[empty]",
    "",
    "Pre-extracted timestamped events:",
    JSON.stringify(incident.timestampedEvents ?? [], null, 2),
    "",
    "Output requirements:",
    "- Return the exact JSON shape required by the supplied strict json_schema.",
    "- Include all eight agents with status complete.",
    "- The evidence graph must connect concrete evidence to inferences and candidate faults.",
    "- Hypotheses must include tests and falsification signals.",
    "- Safety warnings must be actionable and must not recommend bypassing safeguards.",
    "- xPost must mention @Cerebras and @googlegemma.",
    "- discordSubmission must be ready to paste into a hackathon channel.",
  ].join("\n");
}

export function buildFullInvestigationMessages(
  incident: Incident,
  imageDataUrl?: string,
  visionFindings?: string[],
  priorIncidents?: PriorIncidentContext[],
): ChatMessage[] {
  const userContent: ChatMessage["content"] = imageDataUrl
    ? [
        { type: "text", text: formatIncidentEvidence(incident, imageDataUrl, visionFindings, priorIncidents) },
        { type: "image_url", image_url: { url: imageDataUrl } },
      ]
    : formatIncidentEvidence(incident, undefined, visionFindings, priorIncidents);

  return [
    {
      role: "system",
      content: [
        "You are FactoryLens, an industrial incident-response intelligence layer.",
        "You are not a chatbot. You coordinate specialized agents and produce a structured, safety-aware repair decision.",
        "Use only supplied evidence. If evidence is missing, ask for it in missingData instead of inventing it.",
        "Return JSON only through the configured structured output schema.",
      ].join("\n"),
    },
    {
      role: "user",
      content: userContent,
    },
  ];
}

export function buildRepairMessages(malformedOutput: string): ChatMessage[] {
  return [
    {
      role: "system",
      content: "You repair invalid FactoryLens JSON. Return only valid JSON matching the configured schema.",
    },
    {
      role: "user",
      content: [
        "The prior model output did not parse or did not satisfy the required schema.",
        "Repair it without adding facts. Preserve the technical content, remove extra prose, and return only the schema-valid JSON object.",
        "",
        "Malformed output:",
        malformedOutput.slice(0, 12000),
      ].join("\n"),
    },
  ];
}

// --- Dedicated agent prompts for the multi-agent pipeline ---

/** Vision Inspector — a real multimodal Gemma 4 pass on the supplied image. */
export function buildVisionMessages(incident: Incident, imageDataUrl: string): ChatMessage[] {
  const instructions = [
    "You are the FactoryLens Vision Inspector agent.",
    "Inspect ONLY what is visibly present in the attached image of industrial equipment.",
    "Tie each observation to uncertainty. Do not invent details, readings, or labels you cannot see.",
    "Separate clear observations from things that require a closer look.",
    "",
    `Incident context: ${incident.incidentTitle} on a ${incident.machineType} (severity: ${incident.severity}).`,
    "",
    "Return JSON only:",
    "- imageProvided: true",
    "- conditionSummary: one concise sentence describing the visible condition.",
    "- observations: concrete visible findings (wear, contamination, damage, misalignment, discoloration, debris).",
    "- requestedEvidence: additional photos/angles that would reduce uncertainty.",
  ].join("\n");

  return [
    { role: "system", content: "You are a precise industrial vision inspector. Report only visible evidence. Return JSON only." },
    {
      role: "user",
      content: [
        { type: "text", text: instructions },
        { type: "image_url", image_url: { url: imageDataUrl } },
      ],
    },
  ];
}

/** Skeptic — adversarially reviews the synthesized hypotheses and forces a calibrated revision. */
export function buildSkepticMessages(incident: Incident, hypotheses: { rank: number; hypothesis: string; confidence: number; evidenceFor: string[]; evidenceAgainst: string[] }[], hasImage: boolean): ChatMessage[] {
  const hypothesisDigest = hypotheses
    .map((h) => `#${h.rank} (${h.confidence}%): ${h.hypothesis}\n   for: ${h.evidenceFor.join("; ") || "—"}\n   against: ${h.evidenceAgainst.join("; ") || "—"}`)
    .join("\n");

  return [
    {
      role: "system",
      content:
        "You are the FactoryLens Skeptic agent. You red-team the other agents' conclusions. You attack overconfidence, missing evidence, causal-order errors, and unsafe assumptions. You are rigorous, not contrarian. Return JSON only.",
    },
    {
      role: "user",
      content: [
        `Incident: ${incident.incidentTitle} on a ${incident.machineType} (severity: ${incident.severity}).`,
        `Image evidence available: ${hasImage ? "yes" : "NO — no visual confirmation"}.`,
        "",
        "Proposed ranked hypotheses:",
        hypothesisDigest,
        "",
        "Critically review them. Then return JSON:",
        "- overallAssessment: one sentence on whether the leading conclusion is adequately supported.",
        "- critique: specific weaknesses (missing evidence, untested causal order, overconfidence, unverified visual claims).",
        "- adjustments: for each hypothesis rank, a revisedConfidence (0-100) reflecting honest calibration after critique, with a one-line reason.",
        "- addedMissingData: concrete evidence that must be collected before acting.",
        "- revisedConfidenceLevel: low | medium | high for the overall investigation after your review.",
        "",
        "Rule: if there is no image and no replay/test yet, the leading hypothesis cannot be high-confidence. Lower it accordingly.",
      ].join("\n"),
    },
  ];
}

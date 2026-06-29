import { AGENT_PROFILES } from "./agents";
import { getGraphSeed } from "./simulatedIncidents";
import {
  DEFAULT_CEREBRAS_MODEL,
  type AnalysisResponse,
  type EvidenceGraphEdge,
  type FinalReport,
  type Hypothesis,
  type Incident,
  type InvestigationAgent,
  type InvestigationResult,
  type MissingDataRequest,
  type PipelineTelemetry,
  type SafetyWarning,
  type SkepticReview,
  type TimelineEvent,
  type TimelineSeverity,
  type VisionObservations,
} from "./types";

interface MockOptions {
  elapsedMs?: number;
  warning?: string;
  error?: string;
}

const normalize = (value: string) => value.toLowerCase();

const has = (incident: Incident, token: string) =>
  normalize(`${incident.id} ${incident.incidentTitle} ${incident.machineType} ${incident.logs} ${incident.config} ${incident.maintenanceNotes} ${incident.operatorNotes}`).includes(token);

const lines = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

const capitalize = (value: string) => (value ? value.charAt(0).toUpperCase() + value.slice(1) : value);

// Deterministic pseudo-metrics so the server route and the client fallback render identical numbers.
function deterministicSeed(incident: Incident) {
  return incident.logs.length + incident.config.length + incident.incidentTitle.length + incident.machineType.length;
}

function fallbackTimeline(incident: Incident): TimelineEvent[] {
  if (incident.timestampedEvents?.length) return incident.timestampedEvents;

  const rows = lines(incident.logs)
    .slice(0, 8)
    .map((line, index) => {
      const match = line.match(/^(\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)/);
      const severity: TimelineSeverity = /alarm|trip|stop|fault|abort|error/i.test(line)
        ? "critical"
        : /warning|current|temp|vibration|slip/i.test(line)
          ? "warning"
          : "info";
      return {
        timestamp: match?.[1] ?? `T+${index + 1}`,
        event: line.replace(/^(\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)\s*/, ""),
        source: "Log evidence",
        severity,
      } satisfies TimelineEvent;
    });

  return rows.length
    ? rows
    : [
        {
          timestamp: "T+0",
          event: "Incident evidence is incomplete; collect controller logs, config state, images, and operator observations.",
          source: "FactoryLens",
          severity: "warning",
        },
      ];
}

function makeEvidenceGraph(incident: Incident, imageIncluded: boolean): InvestigationResult["evidenceGraph"] {
  const labels = getGraphSeed(incident);
  const nodes = labels.map((label, index) => ({
    id: `n${index + 1}`,
    label,
    type:
      index === labels.length - 1
        ? ("fault" as const)
        : index === labels.length - 2
          ? ("inference" as const)
          : imageIncluded && index === 0
            ? ("image" as const)
            : /note|vibration|grinding|dust|wear|smell|slip/i.test(label)
              ? ("note" as const)
              : index === 0
                ? ("config" as const)
                : ("log" as const),
  }));

  const edgeLabels = ["precedes", "leads to", "triggers", "points to", "explained by"];
  const edges: EvidenceGraphEdge[] = nodes.slice(0, -1).map((node, index) => ({
    from: node.id,
    to: nodes[index + 1].id,
    label: edgeLabels[index] ?? "supports",
  }));

  return { nodes, edges };
}

function buildAgents(incident: Incident, timeline: TimelineEvent[], rootCause: string, imageIncluded: boolean): InvestigationAgent[] {
  const criticalEvents = timeline.filter((event) => event.severity !== "info");
  const triggerEvent = [...timeline].reverse().find((event) => event.severity === "critical") ?? timeline[timeline.length - 1];
  const incidentIsSevere = incident.severity === "high" || incident.severity === "critical";
  const maintenanceLines = lines(incident.maintenanceNotes);
  const configLines = lines(incident.config).filter((line) => /threshold|limit|stop|interlock|max|safety|temp|current|speed/i.test(line));

  const byId: Record<string, Pick<InvestigationAgent, "summary" | "keyFindings" | "confidence" | "severity">> = {
    "log-forensics": {
      summary: triggerEvent
        ? `Reconstructed ${timeline.length} events; protective trigger at ${triggerEvent.timestamp}.`
        : `Reconstructed ${timeline.length} events from the supplied logs.`,
      keyFindings: (criticalEvents.length ? criticalEvents : timeline).slice(0, 4).map((event) => `${event.timestamp} ${event.event}`),
      confidence: 84,
      severity: criticalEvents.some((event) => event.severity === "critical") ? "critical" : "warning",
    },
    "vision-inspector": imageIncluded
      ? {
          summary: "Inspected the attached image and correlated visible condition with the log timeline.",
          keyFindings: ["Visible wear/contamination noted near the implicated component.", "Image observations treated as supporting, not conclusive, evidence."],
          confidence: 64,
          severity: "warning",
        }
      : {
          summary: "No image was provided; visual inspection remains pending.",
          keyFindings: [
            "Collect close-ups of the affected component and surrounding area.",
            "Capture the alarm screen, cable state, wear marks, and thermal clues.",
            "Do not claim visual evidence until an image is supplied.",
          ],
          confidence: 48,
          severity: "warning",
        },
    "controls-engineer": {
      summary: "Reviewed thresholds, interlocks, and motion limits against the observed trip.",
      keyFindings: configLines.length
        ? configLines.slice(0, 3)
        : ["No anomalous control thresholds isolated from the supplied config.", "Protective stop behaved as configured."],
      confidence: 76,
      severity: incidentIsSevere ? "critical" : "warning",
    },
    "maintenance-engineer": {
      summary: maintenanceLines.length
        ? "Physical symptoms in the maintenance record are consistent with progressive mechanical degradation."
        : "No maintenance history supplied; physical-wear assessment is limited.",
      keyFindings: maintenanceLines.length
        ? maintenanceLines.slice(0, 3)
        : ["Request recent inspection, lubrication, and replacement records."],
      confidence: maintenanceLines.length ? 74 : 52,
      severity: "warning",
    },
    "root-cause": {
      summary: capitalize(rootCause) + " is the leading hypothesis.",
      keyFindings: [
        "Evidence ordering supports a mechanical/degradation chain over a transient fault.",
        "Two alternative hypotheses retained pending falsification tests.",
      ],
      confidence: 80,
      severity: "critical",
    },
    skeptic: {
      summary: "Challenged the leading hypothesis for overconfidence and missing evidence.",
      keyFindings: [
        imageIncluded ? "Image corroboration is partial; avoid over-reading visual cues." : "No image or replay yet — visual confirmation is missing.",
        "Causal order is inferred from logs alone; confirm with a controlled replay.",
      ],
      confidence: 55,
      severity: "warning",
    },
    "safety-officer": {
      summary: incidentIsSevere
        ? "Treat the protective stop as a genuine safety event; lockout/tagout required before inspection."
        : "Standard precautions apply before hands-on inspection.",
      keyFindings: [
        "Apply lockout/tagout (or the site equivalent) before touching the machine.",
        "Do not bypass or reset the protective trip to keep the line running.",
      ],
      confidence: 86,
      severity: incidentIsSevere ? "critical" : "warning",
    },
    "incident-commander": {
      summary: `Decision: stabilize safely, then verify ${rootCause} before any repair or restart.`,
      keyFindings: ["Owns the final safety-aware repair decision.", "Escalate to a human engineer if falsification tests are inconclusive."],
      confidence: 78,
      severity: incidentIsSevere ? "critical" : "warning",
    },
  };

  return AGENT_PROFILES.map((profile) => {
    const detail = byId[profile.id] ?? {
      summary: "Completed analysis of the supplied evidence.",
      keyFindings: [],
      confidence: 60,
      severity: "info" as TimelineSeverity,
    };
    return { ...profile, status: "complete", ...detail };
  });
}

function buildHypotheses(incident: Incident, rootCause: string): Hypothesis[] {
  const machine = incident.machineType.toLowerCase();
  return [
    {
      rank: 1,
      hypothesis: capitalize(rootCause) + ` caused the ${machine} failure.`,
      evidenceFor: ["Symptom escalation in the logs precedes the protective stop.", "Maintenance/operator notes align with progressive degradation."],
      evidenceAgainst: ["No image or replay yet fully excludes a transient cause."],
      confidence: 84,
      recommendedTest: "Inspect the implicated component and replay the motion at reduced rate while trending the key signals.",
      falsificationSignal: "Signals stay nominal under the controlled replay with no physical wear found.",
    },
    {
      rank: 2,
      hypothesis: "An aggressive setpoint or threshold pushed a marginal component past its limit.",
      evidenceFor: ["The fault coincided with high-demand operation.", "Config shows tight limits with stop-on-error enabled."],
      evidenceAgainst: ["Setpoints alone do not explain the physical symptoms reported."],
      confidence: 58,
      recommendedTest: "Re-run the sequence at reduced acceleration/load while monitoring the protective thresholds.",
      falsificationSignal: "Fault persists at conservative setpoints, implicating hardware instead.",
    },
    {
      rank: 3,
      hypothesis: "A transient interference or external disturbance created a one-off overload.",
      evidenceFor: ["A following/over-limit event can be triggered by contact or disturbance."],
      evidenceAgainst: ["Operator notes report no visible obstruction or collision."],
      confidence: 27,
      recommendedTest: "Inspect the work envelope and replay to check for repeatability.",
      falsificationSignal: "The fault reproduces cleanly with no external disturbance present.",
    },
  ];
}

function buildMissingData(incident: Incident, imageIncluded: boolean): MissingDataRequest[] {
  const requests: MissingDataRequest[] = [];
  if (!imageIncluded) {
    requests.push({
      item: "Photo of the affected component and alarm screen",
      reason: "Visual evidence is required to confirm wear, contamination, or damage before committing to a repair.",
      priority: "high",
    });
  }
  if (!lines(incident.maintenanceNotes).length) {
    requests.push({
      item: "Recent maintenance and inspection records",
      reason: "Service history is needed to distinguish wear-driven failure from a configuration issue.",
      priority: "medium",
    });
  }
  requests.push({
    item: "High-rate sensor trace around the trigger event",
    reason: "Full-resolution signals would confirm the causal order inferred from the summary logs.",
    priority: "medium",
  });
  return requests;
}

function buildSafetyWarnings(incident: Incident): SafetyWarning[] {
  const severe = incident.severity === "high" || incident.severity === "critical";
  const warnings: SafetyWarning[] = [
    {
      warning: "Equipment is in a protective-stop state.",
      severity: severe ? "critical" : "warning",
      requiredAction: "Apply lockout/tagout (or the site equivalent) and verify zero energy before any hands-on inspection.",
    },
  ];
  if (severe) {
    warnings.push({
      warning: "Do not reset or bypass the protective trip to keep the line running.",
      severity: "critical",
      requiredAction: "Treat the trip as a real safety signal; clear the root cause before re-enabling automatic motion.",
    });
  }
  return warnings;
}

function buildFinalReport(incident: Incident, rootCause: string, timeline: TimelineEvent[], imageIncluded: boolean): FinalReport {
  const machine = incident.machineType.toLowerCase();
  const triggerEvent = [...timeline].reverse().find((event) => event.severity === "critical");
  const confidenceLevel: FinalReport["confidenceLevel"] =
    timeline.some((event) => event.severity === "critical") && lines(incident.maintenanceNotes).length ? "high" : timeline.length ? "medium" : "low";

  return {
    executiveSummary: `The ${incident.incidentTitle.toLowerCase()} on the ${machine} is best explained by ${rootCause}. The evidence escalates${
      triggerEvent ? ` to a protective stop at ${triggerEvent.timestamp}` : ""
    }, and should be handled as a genuine equipment-protection event until field evidence proves otherwise.`,
    mostLikelyRootCause: `${capitalize(rootCause)} causing the observed escalation and protective stop.`,
    rankedAlternatives: [
      "Aggressive setpoint/threshold pushing a marginal component past its limit.",
      "Transient interference or external disturbance causing a one-off overload.",
    ],
    evidence: [
      `Log timeline shows symptom escalation${triggerEvent ? ` ending in a protective stop at ${triggerEvent.timestamp}` : ""}.`,
      lines(incident.maintenanceNotes).length ? "Maintenance/operator notes corroborate progressive degradation." : "Operator context is consistent with the failure pattern.",
      imageIncluded ? "Attached image provides partial visual corroboration." : "No image supplied; visual confirmation is still outstanding.",
    ],
    immediateDiagnosticSteps: [
      "Secure the machine with lockout/tagout before inspection.",
      "Inspect the implicated component for wear, contamination, or damage.",
      "Replay the motion at reduced rate while trending the key signals.",
    ],
    repairPlan: [
      "Replace or service the degraded component as inspection confirms.",
      "Verify thresholds and interlocks against spec before restart.",
      "Re-enable automatic motion only after a clean low-rate verification run.",
    ],
    safetyWarnings: buildSafetyWarnings(incident).map((warning) => warning.warning),
    missingData: buildMissingData(incident, imageIncluded).map((request) => request.item),
    confidenceLevel,
    recommendedNextAction: `Apply lockout/tagout, inspect the implicated component, then replay at reduced rate to confirm ${rootCause} before any repair or restart.`,
    humanEscalationCriteria: [
      "Falsification tests are inconclusive or contradict the leading hypothesis.",
      "Inspection reveals a safety-critical defect or damage beyond routine service.",
    ],
  };
}

function buildVisionObservations(imageIncluded: boolean): VisionObservations {
  if (!imageIncluded) {
    return {
      imageProvided: false,
      conditionSummary: "No image was supplied for this incident.",
      observations: [],
      requestedEvidence: [
        "Close-up photo of the implicated component and any wear or damage.",
        "Wide shot of the work envelope, cabling, and surroundings.",
        "Photo of the controller alarm screen at the time of the fault.",
      ],
    };
  }
  return {
    imageProvided: true,
    conditionSummary: "Visible wear and localized discoloration near the implicated component.",
    observations: [
      "Surface scoring and wear near the joint / coupling housing.",
      "Localized discoloration consistent with heat buildup.",
      "No external obstruction or foreign object visible in frame.",
    ],
    requestedEvidence: ["Close-up of the gear teeth / coupling surfaces.", "Thermal image captured during operation."],
  };
}

/** Simulates the Skeptic agent's adversarial revision — lowers leading confidence and demands evidence. */
function applyMockSkeptic(result: InvestigationResult, imageIncluded: boolean): InvestigationResult {
  const leadDrop = imageIncluded ? 12 : 23;
  const hypotheses = result.hypotheses.map((hypothesis, index) => {
    const delta = index === 0 ? leadDrop : Math.round(leadDrop / 2);
    return { ...hypothesis, priorConfidence: hypothesis.confidence, confidence: Math.max(0, Math.min(100, hypothesis.confidence - delta)) };
  });
  const before = result.hypotheses[0]?.confidence ?? 0;
  const after = hypotheses[0]?.confidence ?? before;
  const revisedConfidenceLevel: FinalReport["confidenceLevel"] = imageIncluded ? "high" : "medium";

  const review: SkepticReview = {
    overallAssessment: imageIncluded
      ? "The leading cause is plausible and partially corroborated by the image, but still requires a confirming test."
      : "The leading cause is plausible but unproven — without an image or replay, confidence is currently overstated.",
    critique: [
      imageIncluded
        ? "Image corroboration is partial — visible wear is suggestive, not conclusive."
        : "No image and no replay yet — the leading cause cannot be visually confirmed.",
      "Causal order is inferred from summary logs; a controlled replay is still required.",
      "Confidence was lowered to reflect untested assumptions and missing evidence.",
    ],
    confidenceBefore: before,
    confidenceAfter: after,
    revisedConfidenceLevel,
  };

  const addedMissing: MissingDataRequest[] = imageIncluded
    ? []
    : [{ item: "Photo of the implicated component and alarm screen", reason: "Raised by the Skeptic agent — no visual confirmation is available.", priority: "high" }];
  const missingData = [...result.missingData, ...addedMissing.filter((a) => !result.missingData.some((m) => m.item.toLowerCase() === a.item.toLowerCase()))];

  return {
    ...result,
    hypotheses,
    missingData,
    finalReport: { ...result.finalReport, confidenceLevel: revisedConfidenceLevel },
    skepticReview: review,
  };
}

export function createMockInvestigation(incident: Incident, options: MockOptions = {}, imageIncluded = false): AnalysisResponse {
  const timeline = fallbackTimeline(incident);
  const graphSeed = getGraphSeed(incident);
  const rootCause = graphSeed[graphSeed.length - 1] ?? "an undetermined root cause";
  const agents = buildAgents(incident, timeline, rootCause, imageIncluded);
  const finalReport = buildFinalReport(incident, rootCause, timeline, imageIncluded);

  const seed = deterministicSeed(incident);
  const elapsedMs = options.elapsedMs ?? 600 + (seed % 500);
  const completionTokens = 1200 + (seed % 600);
  const promptTokens = 1800 + (seed % 700);

  const baseResult: InvestigationResult = {
    agents,
    timeline,
    evidenceGraph: makeEvidenceGraph(incident, imageIncluded),
    hypotheses: buildHypotheses(incident, rootCause),
    missingData: buildMissingData(incident, imageIncluded),
    safetyWarnings: buildSafetyWarnings(incident),
    finalReport,
    xPost: `FactoryLens diagnosed "${incident.incidentTitle}" on a ${incident.machineType} in ${(elapsedMs / 1000).toFixed(
      1,
    )}s with a multi-agent investigation on Gemma 4 31B — timeline, ranked root causes, and a safety-aware repair decision. Powered by @Cerebras + @googlegemma. #Gemma4 #Cerebras`,
    discordSubmission: [
      `**FactoryLens — Incident Commander Report**`,
      `Incident: ${incident.incidentTitle} (${incident.machineType}, severity: ${incident.severity})`,
      `Most likely root cause: ${finalReport.mostLikelyRootCause}`,
      `Confidence: ${finalReport.confidenceLevel}`,
      `Next action: ${finalReport.recommendedNextAction}`,
    ].join("\n"),
    visionObservations: buildVisionObservations(imageIncluded),
  };

  const result = applyMockSkeptic(baseResult, imageIncluded);

  const calls = (imageIncluded ? 1 : 0) + 2; // vision (if image) + synthesis + skeptic
  const tokensPerSecond = 900 + (seed % 400);
  const pipeline: PipelineTelemetry = {
    provider: "cerebras",
    providerLabel: "Cerebras",
    model: process.env.CEREBRAS_MODEL || DEFAULT_CEREBRAS_MODEL,
    calls,
    wallMs: elapsedMs,
    tokensPerSecond,
    totalTokens: promptTokens + completionTokens,
    ttftMs: 90 + (seed % 80),
    gpuBaselineMs: Math.round((completionTokens / 55) * 1000),
  };

  return {
    mode: "mock",
    warning: options.warning,
    error: options.error,
    elapsedMs,
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
    speed: {
      localLatencyMs: elapsedMs,
      outputTokensPerSecond: tokensPerSecond,
      timeToFirstTokenMs: 90 + (seed % 80),
    },
    pipeline,
    result,
  };
}

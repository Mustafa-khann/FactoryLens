import { buildFullInvestigationMessages, buildRepairMessages, buildSkepticMessages, buildVisionMessages } from "./agents";
import { callCerebrasChatCompletion, type CerebrasCompletionResult } from "./cerebras";
import { investigationResultResponseFormat, skepticResponseFormat, visionResponseFormat } from "./schema";
import {
  DEFAULT_CEREBRAS_MODEL,
  type AnalysisResponse,
  type AnalysisUsage,
  type InvestigationResult,
  type MissingDataRequest,
  type PipelineTelemetry,
  type PriorIncidentContext,
  type SkepticReview,
  type VisionObservations,
} from "./types";

/** Typical sustained output rate (tokens/sec) for a GPU-served build of a model this size — used only to frame the speedup. */
const GPU_BASELINE_TOKENS_PER_SEC = 55;

interface SkepticOutput {
  overallAssessment: string;
  critique: string[];
  adjustments: { rank: number; revisedConfidence: number; reason: string }[];
  addedMissingData: string[];
  revisedConfidenceLevel: "low" | "medium" | "high";
}

/** Normalize a confidence to an integer 0–100 — models sometimes return a 0–1 fraction instead of a percent. */
const toPercent = (value: number) => {
  if (!Number.isFinite(value)) return 0;
  const scaled = value > 0 && value <= 1 ? value * 100 : value;
  return Math.max(0, Math.min(100, Math.round(scaled)));
};

/** Coerce every confidence field onto a consistent 0–100 scale before they reach the UI or the Skeptic. */
function normalizeConfidences(result: InvestigationResult): InvestigationResult {
  return {
    ...result,
    agents: result.agents.map((agent) => ({ ...agent, confidence: toPercent(agent.confidence) })),
    hypotheses: result.hypotheses.map((hypothesis) => ({ ...hypothesis, confidence: toPercent(hypothesis.confidence) })),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInvestigationResult(value: unknown): value is InvestigationResult {
  if (!isRecord(value)) return false;
  if (!Array.isArray(value.agents) || !Array.isArray(value.timeline) || !Array.isArray(value.hypotheses)) return false;
  if (!Array.isArray(value.missingData) || !Array.isArray(value.safetyWarnings)) return false;
  if (!isRecord(value.evidenceGraph) || !Array.isArray(value.evidenceGraph.nodes) || !Array.isArray(value.evidenceGraph.edges)) return false;
  if (!isRecord(value.finalReport)) return false;
  return typeof value.xPost === "string" && typeof value.discordSubmission === "string";
}

/** Accumulates token/latency telemetry across every Gemma 4 call in the pipeline. */
class Telemetry {
  calls = 0;
  promptTokens = 0;
  completionTokens = 0;
  generationSeconds = 0;
  ttftMs: number | undefined;

  record(result: CerebrasCompletionResult) {
    this.calls += 1;
    this.promptTokens += result.usage?.prompt_tokens ?? 0;
    this.completionTokens += result.usage?.completion_tokens ?? 0;
    if (result.speed.localLatencyMs > 0) this.generationSeconds += result.speed.localLatencyMs / 1000;
    if (this.ttftMs === undefined && typeof result.speed.timeToFirstTokenMs === "number") {
      this.ttftMs = result.speed.timeToFirstTokenMs;
    }
  }

  get usage(): AnalysisUsage {
    return {
      prompt_tokens: this.promptTokens,
      completion_tokens: this.completionTokens,
      total_tokens: this.promptTokens + this.completionTokens,
    };
  }

  pipeline(wallMs: number): PipelineTelemetry {
    const tokensPerSecond = this.generationSeconds > 0 ? this.completionTokens / this.generationSeconds : undefined;
    const gpuBaselineMs = this.completionTokens > 0 ? (this.completionTokens / GPU_BASELINE_TOKENS_PER_SEC) * 1000 : undefined;
    return {
      model: process.env.CEREBRAS_MODEL || DEFAULT_CEREBRAS_MODEL,
      calls: this.calls,
      wallMs,
      tokensPerSecond,
      totalTokens: this.promptTokens + this.completionTokens,
      ttftMs: this.ttftMs,
      gpuBaselineMs,
    };
  }
}

async function runVisionAgent(
  telemetry: Telemetry,
  incident: Parameters<typeof buildVisionMessages>[0],
  imageDataUrl?: string,
): Promise<VisionObservations> {
  if (!imageDataUrl) {
    return {
      imageProvided: false,
      conditionSummary: "No image was supplied for this incident.",
      observations: [],
      requestedEvidence: [
        "Close-up photo of the implicated component and any wear or damage.",
        "Wide shot showing the work envelope, cabling, and surroundings.",
        "Photo of the controller alarm screen at the time of the fault.",
      ],
    };
  }
  try {
    const result = await callCerebrasChatCompletion({
      messages: buildVisionMessages(incident, imageDataUrl),
      responseFormat: visionResponseFormat,
      temperature: 0.2,
      maxTokens: 900,
    });
    telemetry.record(result);
    const parsed = result.parsedJson;
    if (isRecord(parsed) && Array.isArray(parsed.observations)) {
      return {
        imageProvided: true,
        conditionSummary: typeof parsed.conditionSummary === "string" ? parsed.conditionSummary : "Visual inspection completed.",
        observations: (parsed.observations as unknown[]).filter((o): o is string => typeof o === "string"),
        requestedEvidence: Array.isArray(parsed.requestedEvidence)
          ? (parsed.requestedEvidence as unknown[]).filter((o): o is string => typeof o === "string")
          : [],
      };
    }
  } catch {
    // Vision is best-effort; fall through to a graceful default.
  }
  return {
    imageProvided: true,
    conditionSummary: "Image was provided but could not be fully analyzed.",
    observations: [],
    requestedEvidence: ["Re-capture a sharper, well-lit photo of the implicated component."],
  };
}

async function runSynthesisAgent(
  telemetry: Telemetry,
  incident: Parameters<typeof buildFullInvestigationMessages>[0],
  visionFindings: string[],
  priorIncidents?: PriorIncidentContext[],
): Promise<{ result: InvestigationResult; warning?: string }> {
  const first = await callCerebrasChatCompletion({
    messages: buildFullInvestigationMessages(incident, undefined, visionFindings, priorIncidents),
    responseFormat: investigationResultResponseFormat,
    temperature: 0.2,
    maxTokens: 5000,
  });
  telemetry.record(first);

  if (isInvestigationResult(first.parsedJson)) {
    return { result: first.parsedJson };
  }

  const repaired = await callCerebrasChatCompletion({
    messages: buildRepairMessages(first.outputText),
    responseFormat: investigationResultResponseFormat,
    temperature: 0.1,
    maxTokens: 5000,
  });
  telemetry.record(repaired);

  if (!isInvestigationResult(repaired.parsedJson)) {
    throw new Error("Gemma 4 structured output did not match the FactoryLens schema after one repair attempt.");
  }
  return { result: repaired.parsedJson, warning: "Structured output required one schema repair pass before rendering." };
}

async function runSkepticAgent(
  telemetry: Telemetry,
  incident: Parameters<typeof buildSkepticMessages>[0],
  result: InvestigationResult,
  hasImage: boolean,
): Promise<SkepticOutput | undefined> {
  try {
    const response = await callCerebrasChatCompletion({
      messages: buildSkepticMessages(incident, result.hypotheses, hasImage),
      responseFormat: skepticResponseFormat,
      temperature: 0.2,
      maxTokens: 1200,
    });
    telemetry.record(response);
    const parsed = response.parsedJson;
    if (isRecord(parsed) && Array.isArray(parsed.critique) && Array.isArray(parsed.adjustments)) {
      return parsed as unknown as SkepticOutput;
    }
  } catch {
    // Skeptic is best-effort; the investigation still stands without the revision.
  }
  return undefined;
}

/** Apply the Skeptic's calibrated revision to the synthesized result — this is the round that changes the answer. */
function applySkepticReview(result: InvestigationResult, skeptic: SkepticOutput): InvestigationResult {
  const leadingBefore = result.hypotheses.find((h) => h.rank === 1)?.confidence ?? result.hypotheses[0]?.confidence ?? 0;

  const hypotheses = result.hypotheses.map((hypothesis) => {
    const adjustment = skeptic.adjustments.find((item) => item.rank === hypothesis.rank);
    if (!adjustment) return hypothesis;
    return { ...hypothesis, priorConfidence: hypothesis.confidence, confidence: toPercent(adjustment.revisedConfidence) };
  });

  const leadingAfter = hypotheses.find((h) => h.rank === 1)?.confidence ?? hypotheses[0]?.confidence ?? leadingBefore;

  const newMissing: MissingDataRequest[] = skeptic.addedMissingData
    .filter((item) => item && !result.missingData.some((existing) => existing.item.toLowerCase() === item.toLowerCase()))
    .map((item) => ({ item, reason: "Raised by the Skeptic agent during adversarial review.", priority: "high" as const }));

  const review: SkepticReview = {
    overallAssessment: skeptic.overallAssessment,
    critique: skeptic.critique,
    confidenceBefore: leadingBefore,
    confidenceAfter: leadingAfter,
    revisedConfidenceLevel: skeptic.revisedConfidenceLevel,
  };

  return {
    ...result,
    hypotheses,
    missingData: [...result.missingData, ...newMissing],
    finalReport: { ...result.finalReport, confidenceLevel: skeptic.revisedConfidenceLevel },
    skepticReview: review,
  };
}

/**
 * Runs the full multi-agent investigation pipeline on Gemma 4 / Cerebras:
 *   Vision Inspector (multimodal) → Synthesis (8 agents) → Skeptic (adversarial revision).
 */
export async function runInvestigationPipeline(
  incident: Parameters<typeof buildFullInvestigationMessages>[0],
  imageDataUrl?: string,
  priorIncidents?: PriorIncidentContext[],
): Promise<AnalysisResponse> {
  const telemetry = new Telemetry();
  const startedAt = Date.now();

  const vision = await runVisionAgent(telemetry, incident, imageDataUrl);
  const { result: synthesizedRaw, warning } = await runSynthesisAgent(telemetry, incident, vision.observations, priorIncidents);
  const synthesized = normalizeConfidences(synthesizedRaw);

  const withVision: InvestigationResult = { ...synthesized, visionObservations: vision };
  const skeptic = await runSkepticAgent(telemetry, incident, withVision, Boolean(imageDataUrl));
  const result = skeptic ? applySkepticReview(withVision, skeptic) : withVision;

  const wallMs = Date.now() - startedAt;
  const pipeline = telemetry.pipeline(wallMs);

  return {
    mode: "live",
    warning,
    elapsedMs: wallMs,
    usage: telemetry.usage,
    speed: {
      localLatencyMs: wallMs,
      outputTokensPerSecond: pipeline.tokensPerSecond,
      timeToFirstTokenMs: pipeline.ttftMs,
    },
    pipeline,
    result,
  };
}

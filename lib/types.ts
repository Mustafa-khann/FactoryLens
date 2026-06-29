export const DEFAULT_CEREBRAS_MODEL = "gemma-4-31b";
export const DEFAULT_GEMINI_MODEL = "gemini-2.5-pro";

export type IncidentSeverity = "low" | "medium" | "high" | "critical";
export type TimelineSeverity = "info" | "warning" | "critical";
export type AgentStatus = "waiting" | "investigating" | "complete" | "failed";
export type InvestigationMode = "live" | "mock";
export type ModelProvider = "cerebras" | "gemini";
export type ReasoningEffort = "none" | "low" | "medium" | "high";

export interface TimelineEvent {
  id?: string;
  timestamp: string;
  event: string;
  source: string;
  severity: TimelineSeverity;
}

export interface Incident {
  id: string;
  incidentTitle: string;
  machineType: string;
  severity: IncidentSeverity;
  logs: string;
  config: string;
  maintenanceNotes: string;
  operatorNotes: string;
  timestampedEvents: TimelineEvent[];
  hiddenGroundTruth?: string;
  expectedRootCause?: string;
  imageName?: string;
}

export interface AgentProfile {
  id: string;
  name: string;
  role: string;
}

export interface InvestigationAgent extends AgentProfile {
  status: "complete";
  summary: string;
  keyFindings: string[];
  confidence: number;
  severity: TimelineSeverity;
}

export interface AgentDisplay extends AgentProfile {
  status: AgentStatus;
  summary: string;
  keyFindings: string[];
  confidence?: number;
  severity?: TimelineSeverity;
}

export interface EvidenceGraphNode {
  id: string;
  label: string;
  type: "log" | "config" | "note" | "image" | "inference" | "fault";
}

export interface EvidenceGraphEdge {
  from: string;
  to: string;
  label: string;
}

export interface Hypothesis {
  rank: number;
  hypothesis: string;
  evidenceFor: string[];
  evidenceAgainst: string[];
  confidence: number;
  /** Confidence before the Skeptic agent's adversarial review (when the debate changed it). */
  priorConfidence?: number;
  recommendedTest: string;
  falsificationSignal: string;
}

/** Output of the dedicated multimodal Vision Inspector agent (real Gemma 4 image pass). */
export interface VisionObservations {
  imageProvided: boolean;
  conditionSummary: string;
  observations: string[];
  requestedEvidence: string[];
}

/** Result of the adversarial Skeptic agent — the round that visibly changes the answer. */
export interface SkepticReview {
  overallAssessment: string;
  critique: string[];
  confidenceBefore: number;
  confidenceAfter: number;
  revisedConfidenceLevel: "low" | "medium" | "high";
}

/** Telemetry for model calls, latency, throughput, and comparison baselines. */
export interface PipelineTelemetry {
  provider: ModelProvider;
  providerLabel: string;
  model: string;
  calls: number;
  wallMs: number;
  tokensPerSecond?: number;
  totalTokens?: number;
  ttftMs?: number;
  /** Estimated wall time for the same work on a typical GPU-served provider. */
  gpuBaselineMs?: number;
}

export interface ModelComparison {
  provider: ModelProvider;
  providerLabel: string;
  model: string;
  label: string;
  status: "complete" | "skipped" | "failed";
  message?: string;
  elapsedMs?: number;
  usage?: AnalysisUsage;
  speed?: SpeedMetrics;
  pipeline?: PipelineTelemetry;
  rootCause?: string;
  confidenceLevel?: "low" | "medium" | "high";
  topHypothesis?: string;
  topConfidence?: number;
}

export interface MissingDataRequest {
  item: string;
  reason: string;
  priority: "low" | "medium" | "high";
}

export interface SafetyWarning {
  warning: string;
  severity: "warning" | "critical";
  requiredAction: string;
}

export interface FinalReport {
  executiveSummary: string;
  mostLikelyRootCause: string;
  rankedAlternatives: string[];
  evidence: string[];
  immediateDiagnosticSteps: string[];
  repairPlan: string[];
  safetyWarnings: string[];
  missingData: string[];
  confidenceLevel: "low" | "medium" | "high";
  recommendedNextAction: string;
  humanEscalationCriteria: string[];
}

export interface InvestigationResult {
  agents: InvestigationAgent[];
  timeline: TimelineEvent[];
  evidenceGraph: {
    nodes: EvidenceGraphNode[];
    edges: EvidenceGraphEdge[];
  };
  hypotheses: Hypothesis[];
  missingData: MissingDataRequest[];
  safetyWarnings: SafetyWarning[];
  finalReport: FinalReport;
  xPost: string;
  discordSubmission: string;
  visionObservations?: VisionObservations;
  skepticReview?: SkepticReview;
}

/** A compact prior drawn from incident memory and fed into the live pipeline so it can recognise repeat failures. */
export interface PriorIncidentContext {
  title: string;
  machineType: string;
  severity: IncidentSeverity;
  diagnosedRootCause: string;
  /** The confirmed root cause once a human recorded the real resolution (high-signal). */
  confirmedRootCause?: string;
  /** What actually fixed the past incident. */
  resolvedFix?: string;
}

export interface AnalysisUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface SpeedMetrics {
  localLatencyMs: number;
  outputTokensPerSecond?: number;
  timeToFirstTokenMs?: number;
}

export interface AnalysisResponse {
  mode: InvestigationMode;
  warning?: string;
  error?: string;
  elapsedMs: number;
  usage?: AnalysisUsage;
  timeInfo?: unknown;
  speed: SpeedMetrics;
  pipeline?: PipelineTelemetry;
  comparisons?: ModelComparison[];
  result: InvestigationResult;
}

export interface ImageEvidenceMeta {
  included: boolean;
  name?: string;
  format?: string;
  sizeBytes?: number;
  dataUrl?: string;
}

"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bot,
  Boxes,
  CheckCircle2,
  Clock,
  Cpu,
  Database,
  Factory,
  FileText,
  Gauge,
  HelpCircle,
  History,
  LayoutDashboard,
  ListOrdered,
  Network,
  Play,
  RefreshCw,
  Share2,
  ShieldAlert,
  ShieldCheck,
  Timer,
  Users,
  X,
  Zap,
} from "lucide-react";
import { EmptyState, Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { AgentWarRoom } from "@/components/AgentWarRoom";
import { EvidenceGraph } from "@/components/EvidenceGraph";
import { FinalReport } from "@/components/FinalReport";
import { HistoryPanel } from "@/components/HistoryPanel";
import { HypothesisBattle } from "@/components/HypothesisBattle";
import { ImageEvidencePanel } from "@/components/ImageEvidencePanel";
import { MujocoSimulation } from "@/components/MujocoSimulation";
import { SimilarIncidents } from "@/components/SimilarIncidents";
import { SpeedPanel } from "@/components/SpeedPanel";
import { StatusBadge } from "@/components/StatusBadge";
import { Timeline } from "@/components/Timeline";
import { AGENT_PROFILES, createEmptyAgents } from "@/lib/agents";
import {
  clearAllIncidents,
  clearResolution,
  deleteIncident,
  findSimilarIncidents,
  loadIncidents,
  recordResolution,
  saveInvestigation,
  toPriorContext,
  type SavedIncident,
  type ScoredIncident,
} from "@/lib/incidentMemory";
import type { AgentDisplay, AnalysisResponse, ImageEvidenceMeta, Incident, MissingDataRequest, SafetyWarning } from "@/lib/types";

type TabId = "overview" | "simulation" | "agents" | "timeline" | "evidence" | "hypotheses" | "safety" | "history" | "diagnostics";

// The investigation starts with no evidence — the digital twin is the only
// source. The user reproduces a fault in the Simulation tab and captures it,
// which replaces this placeholder and unlocks the run.
const EMPTY_INCIDENT: Incident = {
  id: "awaiting-evidence",
  incidentTitle: "Awaiting simulation evidence",
  machineType: "—",
  severity: "low",
  logs: "",
  config: "",
  maintenanceNotes: "",
  operatorNotes: "",
  timestampedEvents: [],
};

function formatMs(ms: number) {
  if (!ms) return "0.0s";
  return `${(ms / 1000).toFixed(1)}s`;
}

const GROUND_TRUTH_STOPWORDS = new Set([
  "the", "and", "into", "its", "with", "that", "caused", "cause", "root", "robot", "parts", "part",
  "were", "was", "drove", "drop", "dropped", "short", "before", "after", "reaching", "stopped", "point",
]);

/** Lenient token-overlap match between the twin's hidden ground truth and the
 *  agents' verdict — true when they name the same failure. Returns null if either
 *  side is missing (no ground truth to score against). */
function diagnosisMatchesGroundTruth(expected: string | undefined, diagnosis: string): boolean | null {
  if (!expected || !diagnosis.trim()) return null;
  const tokens = (s: string) =>
    new Set(
      s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 3 && !GROUND_TRUTH_STOPWORDS.has(w)),
    );
  const expectedTokens = [...tokens(expected)];
  if (!expectedTokens.length) return null;
  const diagnosisTokens = tokens(diagnosis);
  const hits = expectedTokens.filter((w) => diagnosisTokens.has(w)).length;
  return hits >= 3 || hits / expectedTokens.length >= 0.4;
}

function MissingDataPanel({ requests }: { requests: MissingDataRequest[] }) {
  return (
    <Panel title="Missing Data Requests" subtitle="Evidence to collect before a confident decision." icon={<HelpCircle className="h-4 w-4" />} bodyClassName="p-0">
      {requests.length ? (
        <div className="divide-y divide-slate-100">
          {requests.map((request) => (
            <article key={`${request.priority}-${request.item}`} className="px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-[13px] font-semibold leading-5 text-slate-950">{request.item}</h3>
                <StatusBadge value={request.priority === "high" ? "critical" : request.priority === "medium" ? "warning" : "info"} tone="severity" dot />
              </div>
              <p className="mt-1.5 text-xs leading-5 text-slate-500">{request.reason}</p>
            </article>
          ))}
        </div>
      ) : (
        <div className="p-5">
          <EmptyState>No additional data requested. The evidence on hand was sufficient.</EmptyState>
        </div>
      )}
    </Panel>
  );
}

function SafetyWarningsPanel({ warnings }: { warnings: SafetyWarning[] }) {
  const hasCritical = warnings.some((w) => w.severity === "critical");
  return (
    <Panel
      title="Safety Warnings"
      subtitle="Hazards and required actions before any repair."
      icon={<ShieldAlert className="h-4 w-4" />}
      accent={hasCritical ? "danger" : warnings.length ? "warn" : "default"}
      bodyClassName="p-0"
    >
      {warnings.length ? (
        <div className="divide-y divide-slate-100">
          {warnings.map((warning) => (
            <article key={warning.warning} className={`px-5 py-4 ${warning.severity === "critical" ? "bg-red-50/45" : "bg-amber-50/45"}`}>
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-[13px] font-semibold leading-5 text-slate-950">{warning.warning}</h3>
                <StatusBadge value={warning.severity} tone="severity" dot />
              </div>
              <p className="mt-1.5 text-xs leading-5 text-slate-600">{warning.requiredAction}</p>
            </article>
          ))}
        </div>
      ) : (
        <div className="p-5">
          <EmptyState>No safety warnings raised for this incident.</EmptyState>
        </div>
      )}
    </Panel>
  );
}

function LogoMark() {
  return (
    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-950 text-cyan-300 shadow-sm ring-1 ring-white/10">
      <Factory className="h-5 w-5" />
    </span>
  );
}

function HeaderChip({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 text-xs shadow-card">
      <span className="text-slate-400">{icon}</span>
      <span className="text-slate-500">{label}</span>
      <span className="font-mono font-medium tabular-nums text-slate-900">{value}</span>
    </div>
  );
}

function SignalPill({ icon, label, value, tone = "default" }: { icon: ReactNode; label: string; value: string; tone?: "default" | "live" | "warn" }) {
  const toneClass =
    tone === "live"
      ? "border-emerald-300/40 bg-emerald-400/10 text-emerald-100"
      : tone === "warn"
        ? "border-amber-300/50 bg-amber-300/10 text-amber-100"
        : "border-white/[0.15] bg-white/[0.08] text-slate-100";
  return (
    <span className={`inline-flex h-8 items-center gap-2 rounded-lg border px-2.5 text-xs font-medium ${toneClass}`}>
      <span className="text-current/75">{icon}</span>
      <span className="text-current/65">{label}</span>
      <span className="font-semibold text-current">{value}</span>
    </span>
  );
}

function HeroMetric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="min-w-0 border-t border-white/10 pt-3">
      <p className="flex items-center gap-2 text-xs text-slate-300">
        <span className="text-cyan-300">{icon}</span>
        {label}
      </p>
      <p className="mt-1 truncate font-mono text-lg font-semibold tabular-nums text-white">{value}</p>
    </div>
  );
}

function Kpi({ label, value, icon, tone = "default" }: { label: string; value: string; icon: ReactNode; tone?: "default" | "good" | "warn" | "bad" }) {
  const toneClass =
    tone === "good" ? "text-emerald-600" : tone === "warn" ? "text-amber-600" : tone === "bad" ? "text-red-600" : "text-slate-950";
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3.5 shadow-card">
      <p className="flex items-center gap-2 text-xs font-medium text-slate-500">
        <span className="text-slate-400">{icon}</span>
        {label}
      </p>
      <p className={`mt-1 text-lg font-semibold capitalize tabular-nums ${toneClass}`}>{value}</p>
    </div>
  );
}

function StageLine({ icon, title, caption, active }: { icon: ReactNode; title: string; caption: string; active?: boolean }) {
  return (
    <div className={`flex items-start gap-3 rounded-lg border px-3 py-3 ${active ? "border-cyan-200 bg-cyan-50" : "border-slate-200 bg-white"}`}>
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${active ? "bg-cyan-600 text-white" : "bg-slate-100 text-slate-500"}`}>{icon}</span>
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-slate-950">{title}</p>
        <p className="mt-0.5 text-xs leading-5 text-slate-500">{caption}</p>
      </div>
    </div>
  );
}

type WorkflowState = "complete" | "active" | "idle";

function WorkflowStep({
  icon,
  title,
  caption,
  state,
}: {
  icon: ReactNode;
  title: string;
  caption: string;
  state: WorkflowState;
}) {
  const stateClass =
    state === "complete"
      ? "border-emerald-200 bg-emerald-50/75"
      : state === "active"
        ? "border-cyan-200 bg-cyan-50/85"
        : "border-slate-200 bg-white";
  const iconClass =
    state === "complete"
      ? "bg-emerald-600 text-white"
      : state === "active"
        ? "bg-cyan-700 text-white"
        : "bg-slate-100 text-slate-500";

  return (
    <div className={`flex items-start gap-3 rounded-lg border px-3 py-3 ${stateClass}`}>
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${iconClass}`}>
        {state === "complete" ? <CheckCircle2 className="h-4 w-4" /> : icon}
      </span>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-[13px] font-semibold text-slate-950">{title}</p>
          {state === "active" ? <span className="h-1.5 w-1.5 rounded-full bg-cyan-600" /> : null}
        </div>
        <p className="mt-0.5 text-xs leading-5 text-slate-500">{caption}</p>
      </div>
    </div>
  );
}

function SourceEventList({ incident }: { incident: Incident }) {
  if (!incident.timestampedEvents.length) {
    return (
      <div className="p-5">
        <EmptyState icon={<Clock className="h-4 w-4" />} title="No twin events captured">
          Reproduce a failure in the Simulation tab, then capture it to create the source timeline.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="divide-y divide-slate-100">
      {incident.timestampedEvents.slice(0, 5).map((event) => (
        <div key={`${event.timestamp}-${event.event}`} className="grid gap-2 px-5 py-3 sm:grid-cols-[96px_minmax(0,1fr)_auto] sm:items-center">
          <span className="font-mono text-xs font-semibold tabular-nums text-slate-600">{event.timestamp}</span>
          <span className="text-[13px] leading-5 text-slate-800">{event.event}</span>
          <StatusBadge value={event.severity} tone="severity" dot />
        </div>
      ))}
    </div>
  );
}

export default function Home() {
  const [incident, setIncident] = useState<Incident>(EMPTY_INCIDENT);
  // True once the twin has captured evidence into the incident — gates the run.
  const [hasEvidence, setHasEvidence] = useState(false);
  // Fault ids captured from the twin (so the verdict can verify the recommended fix).
  const [capturedFaultIds, setCapturedFaultIds] = useState<string[]>([]);
  const [verifyNonce, setVerifyNonce] = useState(0);
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [speedDemo, setSpeedDemo] = useState<AnalysisResponse | null>(null);
  const [speedDemoLoading, setSpeedDemoLoading] = useState(false);
  const [agents, setAgents] = useState<AgentDisplay[]>(() => createEmptyAgents());
  const [image, setImage] = useState<ImageEvidenceMeta>({ included: false });
  const [loading, setLoading] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [reportReady, setReportReady] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>("simulation");
  const [demoMode, setDemoMode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedIncidents, setSavedIncidents] = useState<SavedIncident[]>([]);
  const [similarMatches, setSimilarMatches] = useState<ScoredIncident[]>([]);
  const [priorsUsed, setPriorsUsed] = useState(false);
  const timerRef = useRef<number | null>(null);
  const timeoutsRef = useRef<number[]>([]);

  // Hydrate incident memory from the browser on mount (SSR-safe — guarded inside the lib).
  useEffect(() => {
    setSavedIncidents(loadIncidents());
  }, []);

  function clearTimers() {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    timeoutsRef.current.forEach((timeout) => window.clearTimeout(timeout));
    timeoutsRef.current = [];
  }

  useEffect(() => clearTimers, []);

  function resetInvestigationState(clearUploadedImage = false) {
    clearTimers();
    setAnalysis(null);
    setSpeedDemo(null);
    setAgents(createEmptyAgents());
    setLoading(false);
    setElapsedMs(0);
    setReportReady(false);
    setActiveTab("simulation");
    setSimilarMatches([]);
    setPriorsUsed(false);
    if (clearUploadedImage) setImage({ included: false });
  }

  function applySimulationEvidence(nextIncident: Incident) {
    resetInvestigationState(false);
    setError(null);
    setIncident(nextIncident);
    setHasEvidence(true);
  }

  function primeAgentMotion(startedAt: number) {
    timerRef.current = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAt);
    }, 100);

    createEmptyAgents().forEach((agent, index) => {
      const timeout = window.setTimeout(() => {
        setAgents((current) =>
          current.map((item) => (item.id === agent.id && item.status === "waiting" ? { ...item, status: "investigating" } : item)),
        );
      }, 180 + index * 520);
      timeoutsRef.current.push(timeout);
    });
  }

  function revealAnalysis(nextAnalysis: AnalysisResponse, startedAt: number) {
    clearTimers();
    setAnalysis(nextAnalysis);
    setReportReady(false);
    setElapsedMs(Date.now() - startedAt);

    timerRef.current = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAt);
    }, 100);

    nextAnalysis.result.agents.forEach((agent, index) => {
      const investigateTimeout = window.setTimeout(() => {
        setAgents((current) => current.map((item) => (item.id === agent.id ? { ...item, status: "investigating" } : item)));
      }, index * 380);
      const completeTimeout = window.setTimeout(() => {
        setAgents((current) => current.map((item) => (item.id === agent.id ? { ...agent, status: "complete" } : item)));
      }, index * 380 + 240);
      timeoutsRef.current.push(investigateTimeout, completeTimeout);
    });

    const doneTimeout = window.setTimeout(() => {
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setElapsedMs(nextAnalysis.elapsedMs || Date.now() - startedAt);
      setReportReady(true);
      setLoading(false);
      setActiveTab("overview");
    }, nextAnalysis.result.agents.length * 380 + 520);
    timeoutsRef.current.push(doneTimeout);
  }

  async function requestAnalysis(options: { includeGeminiComparison?: boolean; matches?: ScoredIncident[] } = {}) {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        incident,
        imageDataUrl: image.included ? image.dataUrl : undefined,
        mode: demoMode ? "demo" : "live",
        includeGeminiComparison: options.includeGeminiComparison,
        // Feed the most similar past incidents in as priors so the war room can recognise repeat failures.
        priorIncidents: (options.matches ?? []).map(toPriorContext),
      }),
    });

    if (!response.ok) {
      let message = `The analysis did not complete (HTTP ${response.status}).`;
      try {
        const errorBody = (await response.json()) as { message?: string };
        if (errorBody?.message) message = errorBody.message;
      } catch {
        // Fall back to the generic message.
      }
      throw new Error(message);
    }

    return (await response.json()) as AnalysisResponse;
  }

  async function runInvestigation() {
    const startedAt = Date.now();
    clearTimers();
    setError(null);
    setLoading(true);
    setAnalysis(null);
    setSpeedDemo(null);
    setReportReady(false);
    setElapsedMs(0);
    setAgents(createEmptyAgents());
    setActiveTab("agents");
    primeAgentMotion(startedAt);

    // Retrieve similar past failures before the run so they can both inform the diagnosis and be shown.
    const matches = findSimilarIncidents(incident, savedIncidents);
    setSimilarMatches(matches);
    setPriorsUsed(!demoMode && matches.length > 0);

    try {
      const nextAnalysis = await requestAnalysis({ matches });
      revealAnalysis(nextAnalysis, startedAt);
      // Persist this investigation so it strengthens future pattern matching.
      const { incidents: updated } = saveInvestigation(incident, nextAnalysis);
      setSavedIncidents(updated);
    } catch (err) {
      // Fail honestly: never present fabricated results as a real diagnosis.
      clearTimers();
      setError(err instanceof Error ? err.message : "The analysis did not complete. Please try again.");
      setAnalysis(null);
      setAgents(createEmptyAgents());
      setReportReady(false);
      setLoading(false);
      setElapsedMs(0);
      setActiveTab("overview");
    }
  }

  async function runSpeedDemo() {
    setSpeedDemoLoading(true);
    try {
      const nextSpeedDemo = await requestAnalysis({ includeGeminiComparison: true });
      setSpeedDemo(nextSpeedDemo);
    } catch {
      // No fabricated timings: leave the comparison empty on failure.
      setSpeedDemo(null);
    } finally {
      setSpeedDemoLoading(false);
    }
  }

  function handleResolve(id: string, resolution: { confirmedRootCause: string; fix: string }) {
    setSavedIncidents(recordResolution(id, resolution));
  }
  function handleClearResolution(id: string) {
    setSavedIncidents(clearResolution(id));
  }
  function handleDeleteIncident(id: string) {
    setSavedIncidents(deleteIncident(id));
  }
  function handleClearAllIncidents() {
    setSavedIncidents(clearAllIncidents());
  }

  const result = analysis?.result;
  const activeTimeline = result?.timeline ?? [];
  const activeGraph = result?.evidenceGraph ?? { nodes: [], edges: [] };
  const activeHypotheses = result?.hypotheses ?? [];
  const activeMissingData = result?.missingData ?? [];
  const activeSafetyWarnings = result?.safetyWarnings ?? [];
  const activeSkepticReview = result?.skepticReview;
  const activeVision = result?.visionObservations;
  const pipeline = analysis?.pipeline;
  const speedup = pipeline?.gpuBaselineMs && pipeline.wallMs ? pipeline.gpuBaselineMs / pipeline.wallMs : undefined;
  const finalReport = reportReady ? result?.finalReport : undefined;
  const hasRun = loading || !!analysis;
  const completedAgents = agents.filter((agent) => agent.status === "complete").length;
  const criticalSafetyCount = activeSafetyWarnings.filter((warning) => warning.severity === "critical").length;
  const sourceEventCount = activeTimeline.length || incident.timestampedEvents.length;
  const runState = loading ? "Investigating" : finalReport ? "Decision ready" : hasEvidence ? "Ready to run" : "Capture needed";
  const speedValue = pipeline?.tokensPerSecond ? `${Math.round(pipeline.tokensPerSecond).toLocaleString()} tok/s` : speedup ? `${speedup.toFixed(0)}x` : "Ready";
  const rootCause = finalReport?.mostLikelyRootCause ?? (hasEvidence ? "Awaiting agent verdict" : "No case captured yet");
  // Score the agents' verdict against the twin's hidden ground truth (when known).
  const groundTruthMatch = finalReport
    ? diagnosisMatchesGroundTruth(incident.expectedRootCause, `${finalReport.mostLikelyRootCause ?? ""} ${activeHypotheses[0]?.hypothesis ?? ""}`)
    : null;
  const workflowBadge = loading ? "running" : finalReport ? "ready" : hasEvidence ? "armed" : "setup";
  const workflowSteps: { icon: ReactNode; title: string; caption: string; state: WorkflowState }[] = [
    {
      icon: <Boxes className="h-4 w-4" />,
      title: "Reproduce",
      caption: "Inject a physical fault in the twin.",
      state: hasEvidence ? "complete" : "active",
    },
    {
      icon: <FileText className="h-4 w-4" />,
      title: "Capture",
      caption: "Turn twin telemetry into case evidence.",
      state: hasEvidence ? "complete" : "idle",
    },
    {
      icon: <Users className="h-4 w-4" />,
      title: "Investigate",
      caption: "Specialists debate the root cause.",
      state: loading ? "active" : finalReport ? "complete" : hasEvidence ? "active" : "idle",
    },
    {
      icon: <ShieldCheck className="h-4 w-4" />,
      title: "Decide",
      caption: "Review repair, safety, and verification.",
      state: finalReport ? "complete" : "idle",
    },
  ];
  const nextAction = !hasEvidence
    ? {
        label: "Open simulation",
        description: "Start by injecting a fault and capturing the evidence packet.",
        icon: <Boxes className="h-4 w-4" />,
        onClick: () => setActiveTab("simulation"),
        primary: true,
      }
    : loading
      ? {
          label: "Watch agents",
          description: "The investigation is running. Follow the specialist handoff in real time.",
          icon: <Users className="h-4 w-4" />,
          onClick: () => setActiveTab("agents"),
          primary: false,
        }
      : finalReport && capturedFaultIds.length
        ? {
            label: "Verify fix in twin",
            description: "Replay the captured fault, apply the repair, and confirm telemetry returns to spec.",
            icon: <ShieldCheck className="h-4 w-4" />,
            onClick: () => {
              setVerifyNonce((n) => n + 1);
              setActiveTab("simulation");
            },
            primary: true,
          }
        : finalReport
          ? {
              label: "Review report",
              description: "The verdict is ready with evidence, repair steps, and escalation criteria.",
              icon: <LayoutDashboard className="h-4 w-4" />,
              onClick: () => setActiveTab("overview"),
              primary: false,
            }
          : {
              label: demoMode ? "Run demo investigation" : "Run live investigation",
              description: "Evidence is captured. Start the multi-agent diagnosis.",
              icon: <Play className="h-4 w-4" />,
              onClick: () => void runInvestigation(),
              primary: true,
            };

  const tabs: { id: TabId; label: string; icon: ReactNode; count?: number }[] = [
    { id: "simulation", label: "Simulation", icon: <Boxes className="h-4 w-4" /> },
    { id: "overview", label: "Verdict", icon: <LayoutDashboard className="h-4 w-4" /> },
    { id: "agents", label: "Agents", icon: <Users className="h-4 w-4" />, count: hasRun ? completedAgents : undefined },
    { id: "timeline", label: "Timeline", icon: <Clock className="h-4 w-4" />, count: activeTimeline.length || undefined },
    { id: "evidence", label: "Evidence", icon: <Share2 className="h-4 w-4" />, count: activeGraph.nodes.length || undefined },
    { id: "hypotheses", label: "Hypotheses", icon: <ListOrdered className="h-4 w-4" />, count: activeHypotheses.length || undefined },
    { id: "safety", label: "Safety", icon: <ShieldAlert className="h-4 w-4" />, count: activeSafetyWarnings.length || undefined },
    { id: "diagnostics", label: "Speed", icon: <Gauge className="h-4 w-4" /> },
    { id: "history", label: "History", icon: <History className="h-4 w-4" />, count: savedIncidents.length || undefined },
  ];

  return (
    <main className="min-h-screen overflow-x-hidden">
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-[rgba(247,249,251,0.9)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1680px] flex-wrap items-center justify-between gap-3 px-4 py-3 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <LogoMark />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-base font-semibold text-slate-950">FactoryLens</h1>
                <span className="rounded-md border border-cyan-200 bg-cyan-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-label text-cyan-800">
                  Hackathon demo
                </span>
              </div>
              <p className="mt-0.5 hidden truncate text-xs text-slate-500 sm:block">MuJoCo digital twin plus AI incident commander.</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden items-center gap-2 lg:flex">
              <HeaderChip icon={<Timer className="h-3.5 w-3.5" />} label="Run time" value={formatMs(elapsedMs)} />
              <HeaderChip icon={<Zap className="h-3.5 w-3.5" />} label="Speed" value={speedValue} />
              <HeaderChip icon={<Database className="h-3.5 w-3.5" />} label="Mode" value={analysis?.mode ?? (demoMode ? "mock" : "live")} />
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={demoMode}
              onClick={() => {
                setDemoMode((value) => !value);
                setError(null);
              }}
              title="Demo mode uses built-in sample data instead of live Gemma 4 analysis."
              className={`inline-flex h-9 items-center gap-2 rounded-lg border px-2.5 text-xs font-medium transition-colors ${
                demoMode ? "border-amber-300 bg-amber-50 text-amber-800" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${demoMode ? "bg-amber-500" : "bg-slate-300"}`} />
              Demo
            </button>
            <Button
              type="button"
              variant="primary"
              size="lg"
              onClick={() => {
                if (hasEvidence) void runInvestigation();
                else setActiveTab("simulation");
              }}
              disabled={loading}
              title={hasEvidence ? undefined : "Reproduce and capture a fault in the Simulation tab first."}
            >
              {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : hasEvidence ? <Play className="h-4 w-4" /> : <Boxes className="h-4 w-4" />}
              {loading ? "Investigating..." : hasEvidence ? (demoMode ? "Run demo" : "Run live") : "Capture evidence"}
            </Button>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-[1680px] px-4 py-5 lg:px-8">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_420px]">
          <div className="factory-hero relative overflow-hidden rounded-lg border border-slate-950 bg-slate-950 px-5 py-5 text-white shadow-pop sm:px-6">
            <div className="relative z-10">
              <div className="flex flex-wrap items-center gap-2">
                <SignalPill icon={<Activity className="h-3.5 w-3.5" />} label="State" value={runState} tone={loading ? "warn" : finalReport ? "live" : "default"} />
                <SignalPill icon={<Cpu className="h-3.5 w-3.5" />} label="Twin" value="MuJoCo WASM" tone="live" />
                <SignalPill icon={<Bot className="h-3.5 w-3.5" />} label="Agents" value={`${completedAgents}/${agents.length}`} />
              </div>

              <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_310px] lg:items-end">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-label text-cyan-200">Incident command surface</p>
                  <h2 className="mt-2 max-w-4xl text-2xl font-semibold leading-tight text-white sm:text-3xl">{incident.incidentTitle}</h2>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
                    {hasEvidence
                      ? `${incident.machineType} investigation with live fault injection, evidence replay, adversarial hypotheses, and a safety-aware repair call.`
                      : "Capture a MuJoCo twin fault to unlock agent analysis, evidence replay, hypotheses, and a safety-aware repair call."}
                  </p>
                </div>
                <div className="rounded-lg border border-white/10 bg-white/[0.07] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-semibold uppercase tracking-label text-slate-400">Current verdict</p>
                    {groundTruthMatch !== null ? (
                      <span
                        className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${
                          groundTruthMatch ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-400/30" : "bg-amber-500/15 text-amber-300 ring-1 ring-amber-400/30"
                        }`}
                        title={`Hidden ground truth from the twin: ${incident.expectedRootCause}`}
                      >
                        {groundTruthMatch ? "✓ Matched injected fault" : "≠ Diverged from injected fault"}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 line-clamp-3 text-sm font-semibold leading-5 text-white">{rootCause}</p>
                </div>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <HeroMetric icon={<ShieldAlert className="h-4 w-4" />} label="Severity" value={hasEvidence ? incident.severity : "none"} />
                <HeroMetric icon={<Clock className="h-4 w-4" />} label="Events" value={`${sourceEventCount}`} />
                <HeroMetric icon={<Network className="h-4 w-4" />} label="Evidence graph" value={`${activeGraph.nodes.length || 0} nodes`} />
                <HeroMetric icon={<Zap className="h-4 w-4" />} label="Latency proof" value={speedup ? `${speedup.toFixed(0)}x faster` : formatMs(elapsedMs)} />
              </div>
            </div>
          </div>

          <aside className="rounded-lg border border-slate-200 bg-white p-4 shadow-card">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-label text-slate-400">Workflow</p>
                <h3 className="mt-1 text-sm font-semibold text-slate-950">Next best action</h3>
              </div>
              <StatusBadge value={workflowBadge} dot />
            </div>

            <div className="mt-4 space-y-2">
              {workflowSteps.map((step) => (
                <WorkflowStep key={step.title} {...step} />
              ))}
            </div>

            <div className="mt-4 border-t border-slate-100 pt-4">
              <p className="text-xs leading-5 text-slate-500">{nextAction.description}</p>
              <Button type="button" variant={nextAction.primary ? "primary" : "secondary"} className="mt-3 w-full justify-between" onClick={nextAction.onClick}>
                <span className="inline-flex items-center gap-2">
                  {nextAction.icon}
                  {nextAction.label}
                </span>
                <ArrowRight className="h-4 w-4 opacity-70" />
              </Button>
            </div>
          </aside>
        </div>
      </section>

      <div className="mx-auto max-w-[1680px] px-4 pb-8 lg:px-8">
        <section className="min-w-0 space-y-4">
          {error ? (
            <div className="flex animate-fade-in items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3.5 text-sm text-red-900 shadow-card">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                <div>
                  <p className="font-medium">Analysis did not complete</p>
                  <p className="mt-0.5 text-red-700">{error}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setError(null)}
                className="-mr-1 shrink-0 rounded-md p-1 text-red-400 transition-colors hover:bg-red-100 hover:text-red-600"
                aria-label="Dismiss error"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : null}

          {analysis?.warning ? (
            <div className="flex animate-fade-in items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-card">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <div>
                <p className="font-medium">{analysis.warning}</p>
                {analysis.error ? <p className="mt-1 font-mono text-xs text-amber-700/80">{analysis.error}</p> : null}
              </div>
            </div>
          ) : null}

          <nav className="sticky top-[65px] z-20 overflow-x-auto rounded-lg border border-slate-200 bg-white/[0.92] p-1 shadow-card backdrop-blur-xl thin-scrollbar">
            <div className="flex min-w-max items-center gap-1">
              {tabs.map((tab) => {
                const active = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    aria-current={active ? "page" : undefined}
                    className={`inline-flex h-9 items-center gap-2 rounded-md px-3 text-[13px] font-medium transition-colors ${
                      active ? "bg-slate-950 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
                    }`}
                  >
                    {tab.icon}
                    {tab.label}
                    {typeof tab.count === "number" ? (
                      <span className={`rounded-full px-1.5 text-[10px] font-semibold tabular-nums ${active ? "bg-white/[0.15] text-white" : "bg-slate-100 text-slate-500"}`}>
                        {tab.count}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </nav>

          <div key={activeTab} className="animate-fade-in space-y-5">
            {activeTab === "overview" ? (
              !hasRun ? (
                <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
                  <Panel
                    title={hasEvidence ? "Evidence captured" : "No evidence yet"}
                    subtitle={hasEvidence ? "Twin evidence is loaded — run the investigation." : "The digital twin is the evidence source for this investigation."}
                    icon={<Play className="h-4 w-4" />}
                    accent="brand"
                  >
                    <div className="grid gap-3 md:grid-cols-3">
                      <StageLine
                        icon={<FileText className="h-4 w-4" />}
                        title="Evidence"
                        caption={hasEvidence ? `${incident.logs.split("\n").filter(Boolean).length} log rows captured from the twin.` : "Reproduce a fault and capture it in the Simulation tab."}
                        active={hasEvidence}
                      />
                      <StageLine icon={<Cpu className="h-4 w-4" />} title="Twin" caption="MuJoCo UR5e cell with live failure injection." active />
                      <StageLine icon={<Bot className="h-4 w-4" />} title="Agents" caption="Specialists idle until you run the case." />
                    </div>
                    <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
                      {hasEvidence ? (
                        <>
                          <Button type="button" variant="primary" onClick={runInvestigation} disabled={loading}>
                            <Play className="h-4 w-4" />
                            Run investigation
                          </Button>
                          <span className="text-xs leading-5 text-slate-500">Captured case: {incident.machineType}</span>
                        </>
                      ) : (
                        <>
                          <Button type="button" variant="primary" onClick={() => setActiveTab("simulation")}>
                            <Boxes className="h-4 w-4" />
                            Go to the Simulation
                          </Button>
                          <span className="text-xs leading-5 text-slate-500">Reproduce a fault, then capture it to begin.</span>
                        </>
                      )}
                    </div>
                  </Panel>

                  <Panel title="Agent Roster" subtitle="The investigation team that will light up during the run." icon={<Users className="h-4 w-4" />}>
                    <div className="divide-y divide-slate-100">
                      {AGENT_PROFILES.map((agent) => (
                        <div key={agent.id} className="py-2.5 first:pt-0 last:pb-0">
                          <p className="text-[13px] font-semibold text-slate-950">{agent.name.replace(" Agent", "")}</p>
                          <p className="mt-0.5 text-xs leading-5 text-slate-500">{agent.role}</p>
                        </div>
                      ))}
                    </div>
                  </Panel>

                  <Panel title="Source Event Snapshot" subtitle="The raw timeline before agent reconstruction." icon={<Clock className="h-4 w-4" />} className="xl:col-span-2" bodyClassName="p-0">
                    <SourceEventList incident={incident} />
                  </Panel>
                </div>
              ) : (
                <>
                  {finalReport ? (
                    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                      <Kpi
                        icon={<ShieldAlert className="h-4 w-4" />}
                        label="Severity"
                        value={incident.severity}
                        tone={incident.severity === "critical" ? "bad" : incident.severity === "high" ? "warn" : "default"}
                      />
                      <Kpi
                        icon={<CheckCircle2 className="h-4 w-4" />}
                        label="Confidence"
                        value={finalReport.confidenceLevel}
                        tone={finalReport.confidenceLevel === "high" ? "good" : finalReport.confidenceLevel === "medium" ? "warn" : "bad"}
                      />
                      <Kpi icon={<Timer className="h-4 w-4" />} label="Total time" value={formatMs(analysis?.elapsedMs ?? elapsedMs)} />
                      <Kpi icon={<Zap className="h-4 w-4" />} label="Baseline delta" value={speedup ? `${speedup.toFixed(0)}x faster` : "-"} tone={speedup ? "good" : "default"} />
                    </div>
                  ) : null}
                  {finalReport && similarMatches.length ? <SimilarIncidents matches={similarMatches} usedInDiagnosis={priorsUsed} /> : null}
                  <FinalReport report={finalReport} />
                  {finalReport && capturedFaultIds.length ? (
                    <Panel
                      title="Verify the fix"
                      subtitle="Apply the recommended repair back in the digital twin and confirm the fault clears."
                      icon={<ShieldCheck className="h-4 w-4" />}
                      accent="ok"
                    >
                      <div className="flex flex-wrap items-center gap-3">
                        <Button
                          type="button"
                          variant="primary"
                          onClick={() => {
                            setVerifyNonce((n) => n + 1);
                            setActiveTab("simulation");
                          }}
                        >
                          <ShieldCheck className="h-4 w-4" />
                          Apply fix &amp; verify in twin
                        </Button>
                        <span className="text-xs leading-5 text-slate-500">
                          Reproduces the diagnosed fault in the twin, applies the fix, and confirms the breached telemetry returns to spec.
                        </span>
                      </div>
                    </Panel>
                  ) : null}
                </>
              )
            ) : null}

            {activeTab === "simulation" ? (
              <MujocoSimulation
                incident={incident}
                onEvidenceChange={applySimulationEvidence}
                onRunInvestigation={runInvestigation}
                onFaultsCaptured={setCapturedFaultIds}
                verifyRequest={{ nonce: verifyNonce, faults: capturedFaultIds }}
              />
            ) : null}
            {activeTab === "agents" ? <AgentWarRoom agents={agents} loading={loading} elapsedMs={elapsedMs} mode={analysis?.mode} /> : null}
            {activeTab === "timeline" ? <Timeline events={activeTimeline} /> : null}
            {activeTab === "evidence" ? <EvidenceGraph nodes={activeGraph.nodes} edges={activeGraph.edges} /> : null}
            {activeTab === "hypotheses" ? <HypothesisBattle hypotheses={activeHypotheses} skepticReview={activeSkepticReview} /> : null}
            {activeTab === "safety" ? (
              <div className="space-y-5">
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                  <Kpi icon={<ShieldAlert className="h-4 w-4" />} label="Critical hazards" value={`${criticalSafetyCount}`} tone={criticalSafetyCount ? "bad" : "good"} />
                  <Kpi icon={<HelpCircle className="h-4 w-4" />} label="Missing data" value={`${activeMissingData.length}`} tone={activeMissingData.length ? "warn" : "good"} />
                  <Kpi icon={<CheckCircle2 className="h-4 w-4" />} label="Escalation" value={finalReport ? "defined" : "pending"} />
                </div>
                <SafetyWarningsPanel warnings={activeSafetyWarnings} />
                <MissingDataPanel requests={activeMissingData} />
              </div>
            ) : null}
            {activeTab === "history" ? (
              <HistoryPanel
                incidents={savedIncidents}
                onResolve={handleResolve}
                onClearResolution={handleClearResolution}
                onDelete={handleDeleteIncident}
                onClearAll={handleClearAllIncidents}
              />
            ) : null}
            {activeTab === "diagnostics" ? (
              <div className="space-y-5">
                <SpeedPanel analysis={analysis} elapsedMs={elapsedMs} speedDemo={speedDemo} speedDemoLoading={speedDemoLoading} onRunSpeedDemo={runSpeedDemo} />
                <ImageEvidencePanel image={image} mode={analysis?.mode} loading={loading} vision={activeVision} />
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}

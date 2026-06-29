"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
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

function SourceEventList({ incident }: { incident: Incident }) {
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
  const runState = loading ? "Investigating" : finalReport ? "Decision ready" : "Simulation armed";
  const speedValue = pipeline?.tokensPerSecond ? `${Math.round(pipeline.tokensPerSecond).toLocaleString()} tok/s` : speedup ? `${speedup.toFixed(0)}x` : "Ready";
  const rootCause = finalReport?.mostLikelyRootCause ?? incident.expectedRootCause ?? "Awaiting agent verdict";

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
              onClick={runInvestigation}
              disabled={loading || !hasEvidence}
              title={hasEvidence ? undefined : "Reproduce and capture a fault in the Simulation tab first."}
            >
              {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {loading ? "Investigating..." : demoMode ? "Run demo" : "Run live"}
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
                    {incident.machineType} investigation with live fault injection, evidence replay, adversarial hypotheses, and a safety-aware repair call.
                  </p>
                </div>
                <div className="rounded-lg border border-white/10 bg-white/[0.07] p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-label text-slate-400">Current verdict</p>
                  <p className="mt-1 line-clamp-3 text-sm font-semibold leading-5 text-white">{rootCause}</p>
                </div>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <HeroMetric icon={<ShieldAlert className="h-4 w-4" />} label="Severity" value={incident.severity} />
                <HeroMetric icon={<Clock className="h-4 w-4" />} label="Events" value={`${sourceEventCount}`} />
                <HeroMetric icon={<Network className="h-4 w-4" />} label="Evidence graph" value={`${activeGraph.nodes.length || 0} nodes`} />
                <HeroMetric icon={<Zap className="h-4 w-4" />} label="Latency proof" value={speedup ? `${speedup.toFixed(0)}x faster` : formatMs(elapsedMs)} />
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
            <StageLine icon={<Boxes className="h-4 w-4" />} title="Digital twin" caption="Real-time MuJoCo scene with injected physical faults." active={activeTab === "simulation"} />
            <StageLine icon={<Users className="h-4 w-4" />} title="Agent debate" caption="Eight specialists reconstruct, challenge, and converge." active={loading || activeTab === "agents"} />
            <StageLine icon={<ShieldCheck className="h-4 w-4" />} title="Repair decision" caption="Safety gates, missing data, and next action in one view." active={!!finalReport || activeTab === "overview"} />
          </div>
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
                </>
              )
            ) : null}

            {activeTab === "simulation" ? (
              <MujocoSimulation incident={incident} onEvidenceChange={applySimulationEvidence} onRunInvestigation={runInvestigation} />
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

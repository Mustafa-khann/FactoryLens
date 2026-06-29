"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Clock,
  Database,
  Gauge,
  HelpCircle,
  History,
  LayoutDashboard,
  ListOrdered,
  Play,
  RefreshCw,
  Share2,
  ShieldAlert,
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
import { IncidentInput } from "@/components/IncidentInput";
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
import { demoIncidents, generateSyntheticIncident } from "@/lib/simulatedIncidents";
import type { AgentDisplay, AnalysisResponse, ImageEvidenceMeta, Incident, MissingDataRequest, SafetyWarning } from "@/lib/types";

type TabId = "overview" | "agents" | "timeline" | "evidence" | "hypotheses" | "safety" | "history" | "diagnostics";

function cloneIncident(incident: Incident): Incident {
  return {
    ...incident,
    timestampedEvents: incident.timestampedEvents.map((event) => ({ ...event })),
  };
}

function formatMs(ms: number) {
  if (!ms) return "0.0s";
  return `${(ms / 1000).toFixed(1)}s`;
}

function MissingDataPanel({ requests }: { requests: MissingDataRequest[] }) {
  return (
    <Panel title="Missing Data Requests" subtitle="Evidence to collect before a confident decision." icon={<HelpCircle className="h-4 w-4" />} bodyClassName="space-y-2.5 p-5">
      {requests.length ? (
        requests.map((request) => (
          <article key={`${request.priority}-${request.item}`} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3.5">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-[13px] font-semibold leading-5 text-slate-900">{request.item}</h3>
              <StatusBadge value={request.priority === "high" ? "critical" : request.priority === "medium" ? "warning" : "info"} tone="severity" dot />
            </div>
            <p className="mt-1.5 text-xs leading-5 text-slate-500">{request.reason}</p>
          </article>
        ))
      ) : (
        <EmptyState>No additional data requested — the evidence on hand was sufficient.</EmptyState>
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
      bodyClassName="space-y-2.5 p-5"
    >
      {warnings.length ? (
        warnings.map((warning) => (
          <article
            key={warning.warning}
            className={`rounded-lg border p-3.5 ${warning.severity === "critical" ? "border-red-200 bg-red-50/60" : "border-amber-200 bg-amber-50/60"}`}
          >
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-[13px] font-semibold leading-5 text-slate-900">{warning.warning}</h3>
              <StatusBadge value={warning.severity} tone="severity" dot />
            </div>
            <p className="mt-1.5 text-xs leading-5 text-slate-600">{warning.requiredAction}</p>
          </article>
        ))
      ) : (
        <EmptyState>No safety warnings raised for this incident.</EmptyState>
      )}
    </Panel>
  );
}

function LogoMark() {
  return (
    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-white shadow-sm">
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="8.5" />
        <circle cx="12" cy="12" r="3.1" />
        <path d="M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3" />
      </svg>
    </span>
  );
}

function HeaderChip({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5">
      <span className="text-slate-400">{icon}</span>
      <span className="text-[11px] text-slate-500">{label}</span>
      <span className="font-mono text-xs font-medium tabular-nums text-slate-800">{value}</span>
    </div>
  );
}

function Kpi({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "good" | "warn" | "bad" }) {
  const toneClass =
    tone === "good" ? "text-emerald-600" : tone === "warn" ? "text-amber-600" : tone === "bad" ? "text-red-600" : "text-slate-900";
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-card">
      <p className="text-[11px] font-medium text-slate-500">{label}</p>
      <p className={`mt-1 text-lg font-semibold capitalize tabular-nums ${toneClass}`}>{value}</p>
    </div>
  );
}

export default function Home() {
  const [incident, setIncident] = useState<Incident>(() => cloneIncident(demoIncidents[0]));
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [speedDemo, setSpeedDemo] = useState<AnalysisResponse | null>(null);
  const [speedDemoLoading, setSpeedDemoLoading] = useState(false);
  const [agents, setAgents] = useState<AgentDisplay[]>(() => createEmptyAgents());
  const [image, setImage] = useState<ImageEvidenceMeta>({ included: false });
  const [loading, setLoading] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [reportReady, setReportReady] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>("overview");
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
    setActiveTab("overview");
    setSimilarMatches([]);
    setPriorsUsed(false);
    if (clearUploadedImage) setImage({ included: false });
  }

  function selectDemo(id: string) {
    const nextIncident = demoIncidents.find((demo) => demo.id === id);
    if (!nextIncident) return;
    resetInvestigationState(true);
    setIncident(cloneIncident(nextIncident));
  }

  function generateIncident(machineType?: string) {
    resetInvestigationState(true);
    setIncident(generateSyntheticIncident(machineType));
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

  async function requestAnalysis(matches: ScoredIncident[] = []) {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        incident,
        imageDataUrl: image.included ? image.dataUrl : undefined,
        mode: demoMode ? "demo" : "live",
        // Feed the most similar past incidents in as priors so the war room can recognise repeat failures.
        priorIncidents: matches.map(toPriorContext),
      }),
    });

    if (!response.ok) {
      let message = `The analysis didn’t complete (HTTP ${response.status}).`;
      try {
        const errorBody = (await response.json()) as { message?: string };
        if (errorBody?.message) message = errorBody.message;
      } catch {
        // fall back to the generic message
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
      const nextAnalysis = await requestAnalysis(matches);
      revealAnalysis(nextAnalysis, startedAt);
      // Persist this investigation so it strengthens future pattern matching.
      const { incidents: updated } = saveInvestigation(incident, nextAnalysis);
      setSavedIncidents(updated);
    } catch (err) {
      // Fail honestly — never present fabricated results as a real diagnosis.
      clearTimers();
      setError(err instanceof Error ? err.message : "The analysis didn’t complete. Please try again.");
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
      const nextSpeedDemo = await requestAnalysis();
      setSpeedDemo(nextSpeedDemo);
    } catch {
      // No fabricated timings — leave the comparison empty on failure.
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

  const tabs: { id: TabId; label: string; icon: React.ReactNode; count?: number }[] = [
    { id: "overview", label: "Overview", icon: <LayoutDashboard className="h-4 w-4" /> },
    { id: "agents", label: "Agents", icon: <Users className="h-4 w-4" />, count: hasRun ? completedAgents : undefined },
    { id: "timeline", label: "Timeline", icon: <Clock className="h-4 w-4" />, count: activeTimeline.length || undefined },
    { id: "evidence", label: "Evidence", icon: <Share2 className="h-4 w-4" />, count: activeGraph.nodes.length || undefined },
    { id: "hypotheses", label: "Hypotheses", icon: <ListOrdered className="h-4 w-4" />, count: activeHypotheses.length || undefined },
    { id: "safety", label: "Safety & Gaps", icon: <ShieldAlert className="h-4 w-4" />, count: activeSafetyWarnings.length || undefined },
    { id: "history", label: "History", icon: <History className="h-4 w-4" />, count: savedIncidents.length || undefined },
    { id: "diagnostics", label: "Diagnostics", icon: <Gauge className="h-4 w-4" /> },
  ];

  return (
    <main className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1640px] flex-wrap items-center justify-between gap-3 px-4 py-3 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <LogoMark />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-[15px] font-semibold tracking-tight text-slate-900">FactoryLens</h1>
                <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-label text-slate-500">Industrial RCA</span>
              </div>
              <p className="mt-0.5 hidden truncate text-xs text-slate-500 sm:block">
                <span className="text-slate-700">{incident.incidentTitle}</span>
                <span className="mx-1.5 text-slate-300">·</span>
                {incident.machineType}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden items-center gap-2 md:flex">
              <HeaderChip icon={<Clock className="h-3.5 w-3.5" />} label="Time" value={formatMs(elapsedMs)} />
              {pipeline?.tokensPerSecond ? (
                <HeaderChip icon={<Zap className="h-3.5 w-3.5" />} label="Speed" value={`${Math.round(pipeline.tokensPerSecond).toLocaleString()} tok/s`} />
              ) : (
                <HeaderChip icon={<Database className="h-3.5 w-3.5" />} label="Mode" value={analysis?.mode ?? "ready"} />
              )}
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
              className={`hidden items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors sm:inline-flex ${
                demoMode ? "border-amber-300 bg-amber-50 text-amber-700" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${demoMode ? "bg-amber-500" : "bg-slate-300"}`} />
              Demo mode
            </button>
            <Button type="button" variant="primary" size="lg" onClick={runInvestigation} disabled={loading}>
              {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {loading ? "Investigating…" : demoMode ? "Run demo" : "Run investigation"}
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1640px] gap-6 px-4 py-6 lg:grid-cols-[380px_minmax(0,1fr)] lg:px-8">
        {/* Config rail */}
        <aside className="min-w-0 lg:sticky lg:top-[84px] lg:max-h-[calc(100vh-104px)] lg:self-start lg:overflow-y-auto lg:pr-1 thin-scrollbar">
          <IncidentInput
            incident={incident}
            setIncident={setIncident}
            image={image}
            onImageChange={setImage}
            demoCases={demoIncidents}
            onSelectDemo={selectDemo}
            onGenerateSynthetic={generateIncident}
            loading={loading}
          />
        </aside>

        {/* Results workspace */}
        <section className="min-w-0 space-y-5">
          {error ? (
            <div className="flex animate-fade-in items-start justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3.5 text-sm text-red-900 shadow-card">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                <div>
                  <p className="font-medium">Analysis didn’t complete</p>
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
            <div className="flex animate-fade-in items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-card">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <div>
                <p className="font-medium">{analysis.warning}</p>
                {analysis.error ? <p className="mt-1 font-mono text-xs text-amber-700/80">{analysis.error}</p> : null}
              </div>
            </div>
          ) : null}

          {/* Tab bar */}
          <div className="flex flex-wrap items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-card">
            {tabs.map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors ${
                    active ? "bg-brand-600 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  }`}
                >
                  {tab.icon}
                  {tab.label}
                  {typeof tab.count === "number" ? (
                    <span className={`rounded-full px-1.5 text-[10px] font-semibold tabular-nums ${active ? "bg-white/20 text-white" : "bg-slate-100 text-slate-500"}`}>
                      {tab.count}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          {/* Tab content */}
          <div key={activeTab} className="animate-fade-in space-y-5">
            {activeTab === "overview" ? (
              !hasRun ? (
                <Panel title="Overview" subtitle="Start an investigation to see results." icon={<LayoutDashboard className="h-4 w-4" />} accent="brand">
                  <div className="flex flex-col items-center gap-5 py-6 text-center">
                    <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
                      <Play className="h-5 w-5" />
                    </span>
                    <div className="max-w-md">
                      <p className="text-sm font-semibold text-slate-900">Ready to investigate</p>
                      <p className="mt-1 text-[13px] leading-6 text-slate-500">
                        Configure the incident evidence on the left, then run the investigation. Eight specialized agents will reconstruct the failure, debate root
                        causes, and produce a safety-aware repair decision.
                      </p>
                    </div>
                    <div className="flex max-w-xl flex-wrap justify-center gap-1.5">
                      {AGENT_PROFILES.map((agent) => (
                        <span key={agent.id} className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-500">
                          {agent.name.replace(" Agent", "")}
                        </span>
                      ))}
                    </div>
                    <Button type="button" variant="primary" onClick={runInvestigation} disabled={loading}>
                      <Play className="h-4 w-4" />
                      Run investigation
                    </Button>
                  </div>
                </Panel>
              ) : (
                <>
                  {finalReport ? (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <Kpi label="Severity" value={incident.severity} tone={incident.severity === "critical" ? "bad" : incident.severity === "high" ? "warn" : "default"} />
                      <Kpi
                        label="Confidence"
                        value={finalReport.confidenceLevel}
                        tone={finalReport.confidenceLevel === "high" ? "good" : finalReport.confidenceLevel === "medium" ? "warn" : "bad"}
                      />
                      <Kpi label="Total time" value={formatMs(analysis?.elapsedMs ?? elapsedMs)} />
                      <Kpi label="vs GPU baseline" value={speedup ? `≈${speedup.toFixed(0)}× faster` : "—"} tone={speedup ? "good" : "default"} />
                    </div>
                  ) : null}
                  {finalReport && similarMatches.length ? <SimilarIncidents matches={similarMatches} usedInDiagnosis={priorsUsed} /> : null}
                  <FinalReport report={finalReport} />
                </>
              )
            ) : null}

            {activeTab === "agents" ? <AgentWarRoom agents={agents} loading={loading} elapsedMs={elapsedMs} mode={analysis?.mode} /> : null}
            {activeTab === "timeline" ? <Timeline events={activeTimeline} /> : null}
            {activeTab === "evidence" ? <EvidenceGraph nodes={activeGraph.nodes} edges={activeGraph.edges} /> : null}
            {activeTab === "hypotheses" ? <HypothesisBattle hypotheses={activeHypotheses} skepticReview={activeSkepticReview} /> : null}
            {activeTab === "safety" ? (
              <>
                <SafetyWarningsPanel warnings={activeSafetyWarnings} />
                <MissingDataPanel requests={activeMissingData} />
              </>
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
              <>
                <SpeedPanel analysis={analysis} elapsedMs={elapsedMs} speedDemo={speedDemo} speedDemoLoading={speedDemoLoading} onRunSpeedDemo={runSpeedDemo} />
                <ImageEvidencePanel image={image} mode={analysis?.mode} loading={loading} vision={activeVision} />
              </>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}

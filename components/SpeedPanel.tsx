"use client";

import { Gauge, Layers, Play, RefreshCw, Timer, Zap } from "lucide-react";
import { DEFAULT_CEREBRAS_MODEL, DEFAULT_GEMINI_MODEL, type AnalysisResponse } from "@/lib/types";
import { Panel } from "./ui/Panel";
import { Button } from "./ui/Button";

interface SpeedPanelProps {
  analysis?: AnalysisResponse | null;
  elapsedMs: number;
  speedDemo?: AnalysisResponse | null;
  speedDemoLoading: boolean;
  onRunSpeedDemo: () => void;
}

function formatMs(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(2)} s`;
}

function formatRate(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return `${Math.round(value).toLocaleString()}`;
}

function Stat({ icon, label, value, unit }: { icon: React.ReactNode; label: string; value: string; unit?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
      <p className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
        <span className="text-slate-400">{icon}</span>
        {label}
      </p>
      <p className="mt-1 font-mono text-lg font-semibold tabular-nums text-slate-900">
        {value}
        {unit ? <span className="ml-1 text-xs font-medium text-slate-400">{unit}</span> : null}
      </p>
    </div>
  );
}

function ComparisonNotice({ tone, message }: { tone: "warn" | "danger"; message: string }) {
  const toneClass = tone === "danger" ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-800";
  return <div className={`rounded-lg border px-3.5 py-3 text-xs leading-5 ${toneClass}`}>{message}</div>;
}

export function SpeedPanel({ analysis, elapsedMs, speedDemo, speedDemoLoading, onRunSpeedDemo }: SpeedPanelProps) {
  const activeAnalysis = speedDemo ?? analysis;
  const pipeline = activeAnalysis?.pipeline;
  const geminiComparison = activeAnalysis?.comparisons?.find((comparison) => comparison.provider === "gemini");
  const wallMs = pipeline?.wallMs ?? activeAnalysis?.elapsedMs ?? elapsedMs;
  const gpuMs = pipeline?.gpuBaselineMs;
  const tokps = pipeline?.tokensPerSecond ?? activeAnalysis?.speed.outputTokensPerSecond;
  const speedup = gpuMs && wallMs ? gpuMs / wallMs : undefined;
  const geminiMs = geminiComparison?.pipeline?.wallMs ?? geminiComparison?.elapsedMs;
  const geminiTokps = geminiComparison?.pipeline?.tokensPerSecond ?? geminiComparison?.speed?.outputTokensPerSecond;
  const directComparisonRatio = geminiMs && wallMs ? geminiMs / wallMs : undefined;
  const maxModelMs = Math.max(wallMs || 0, geminiMs || 0);
  const gemmaModelWidth = maxModelMs && wallMs ? (wallMs / maxModelMs) * 100 : 100;
  const geminiModelWidth = maxModelMs && geminiMs ? (geminiMs / maxModelMs) * 100 : 100;

  // Bar widths: Cerebras pinned small, GPU baseline scaled relative and capped for layout.
  const ratio = speedup ? Math.min(speedup, 30) : 1;
  const cerebrasWidth = 100 / (1 + ratio);
  const gpuWidth = 100 - cerebrasWidth;

  return (
    <Panel
      title="Gemma 4 vs Gemini"
      subtitle="Run the same multi-agent case on Gemma 4/Cerebras, then optionally compare it with a Gemini SOTA model."
      icon={<Zap className="h-4 w-4" />}
      accent="brand"
      trailing={
        <Button type="button" size="sm" variant="secondary" onClick={onRunSpeedDemo} disabled={speedDemoLoading}>
          {speedDemoLoading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          {speedDemoLoading ? "Comparing..." : speedDemo ? "Re-compare" : "Compare"}
        </Button>
      }
      bodyClassName="space-y-4 p-5"
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat icon={<Timer className="h-3.5 w-3.5" />} label="Total time" value={formatMs(wallMs)} />
        <Stat icon={<Layers className="h-3.5 w-3.5" />} label="Gemma 4 calls" value={pipeline ? String(pipeline.calls) : "-"} />
        <Stat icon={<Gauge className="h-3.5 w-3.5" />} label="Throughput" value={formatRate(tokps)} unit="tok/s" />
        <Stat icon={<Zap className="h-3.5 w-3.5" />} label="First token" value={formatMs(pipeline?.ttftMs ?? activeAnalysis?.speed.timeToFirstTokenMs)} />
      </div>

      {/* Side-by-side latency comparison vs an estimated GPU baseline */}
      <div className="rounded-lg border border-slate-200 bg-white p-3.5">
        <div className="mb-2.5 flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-label text-slate-500">Latency vs GPU baseline</p>
          {speedup ? (
            <span className="rounded-full bg-cyan-50 px-2 py-0.5 text-xs font-semibold text-cyan-800">{speedup.toFixed(0)}x faster</span>
          ) : null}
        </div>
        <div className="space-y-2">
          <div>
            <div className="mb-1 flex items-center justify-between text-[11px]">
              <span className="font-medium text-cyan-800">
                {pipeline?.providerLabel ?? "Cerebras"} - {pipeline?.model ?? DEFAULT_CEREBRAS_MODEL}
              </span>
              <span className="font-mono tabular-nums text-slate-600">{formatMs(wallMs)}</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-cyan-700" style={{ width: `${Math.max(4, cerebrasWidth)}%` }} />
            </div>
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between text-[11px]">
              <span className="font-medium text-slate-500">Est. GPU baseline (~55 tok/s)</span>
              <span className="font-mono tabular-nums text-slate-500">{formatMs(gpuMs)}</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-slate-300" style={{ width: `${Math.max(4, gpuWidth)}%` }} />
            </div>
          </div>
        </div>
        <p className="mt-2.5 text-[11px] leading-4 text-slate-400">
          Baseline estimated from the same token volume at a typical GPU-served rate. Cerebras figures are measured per request.
        </p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-3.5">
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-label text-slate-500">Live model comparison</p>
          {directComparisonRatio ? (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
              {directComparisonRatio >= 1 ? `Gemma 4 ${directComparisonRatio.toFixed(1)}x faster` : `Gemini ${(1 / directComparisonRatio).toFixed(1)}x faster`}
            </span>
          ) : null}
        </div>
        <div className="space-y-3">
          <div>
            <div className="mb-1 flex items-center justify-between text-[11px]">
              <span className="font-medium text-cyan-800">
                {pipeline?.providerLabel ?? "Cerebras"} - {pipeline?.model ?? DEFAULT_CEREBRAS_MODEL}
              </span>
              <span className="font-mono tabular-nums text-slate-600">{formatMs(wallMs)}</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-cyan-700" style={{ width: `${Math.max(4, gemmaModelWidth)}%` }} />
            </div>
            <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-slate-500">
              {activeAnalysis?.result.finalReport.mostLikelyRootCause ?? "Run a live investigation first."}
            </p>
          </div>

          {geminiComparison?.status === "complete" ? (
            <div>
              <div className="mb-1 flex items-center justify-between text-[11px]">
                <span className="font-medium text-violet-700">
                  {geminiComparison.providerLabel} - {geminiComparison.model || DEFAULT_GEMINI_MODEL}
                </span>
                <span className="font-mono tabular-nums text-slate-600">
                  {formatMs(geminiMs)}
                  {geminiTokps ? ` - ${formatRate(geminiTokps)} tok/s` : ""}
                </span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-violet-600" style={{ width: `${Math.max(4, geminiModelWidth)}%` }} />
              </div>
              <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-slate-500">
                {geminiComparison.rootCause ?? geminiComparison.topHypothesis ?? "Gemini returned comparison telemetry."}
                {geminiComparison.confidenceLevel ? ` Confidence: ${geminiComparison.confidenceLevel}.` : ""}
              </p>
            </div>
          ) : geminiComparison?.status === "failed" ? (
            <ComparisonNotice tone="danger" message={geminiComparison.message ?? "Gemini comparison failed."} />
          ) : geminiComparison?.status === "skipped" ? (
            <ComparisonNotice tone="warn" message={geminiComparison.message ?? "Set GEMINI_API_KEY to enable the Gemini comparison."} />
          ) : (
            <ComparisonNotice tone="warn" message="Click Compare to run the same incident against Gemini. Requires GEMINI_API_KEY on the server." />
          )}
        </div>
      </div>

      {activeAnalysis?.timeInfo ? (
        <details className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 text-xs text-slate-500">
          <summary className="cursor-pointer select-none font-medium text-slate-600 hover:text-slate-900">Provider time_info</summary>
          <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono thin-scrollbar">{JSON.stringify(activeAnalysis.timeInfo, null, 2)}</pre>
        </details>
      ) : null}
    </Panel>
  );
}

import { Activity, AlertTriangle, CheckCircle2, Circle, Users } from "lucide-react";
import type { AgentDisplay, InvestigationMode } from "@/lib/types";
import { Panel } from "./ui/Panel";
import { StatusBadge } from "./StatusBadge";

interface AgentWarRoomProps {
  agents: AgentDisplay[];
  loading: boolean;
  elapsedMs: number;
  mode?: InvestigationMode;
}

function AgentIcon({ status }: { status: AgentDisplay["status"] }) {
  if (status === "complete") return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
  if (status === "investigating") return <Activity className="h-4 w-4 animate-pulse text-cyan-700" />;
  if (status === "failed") return <AlertTriangle className="h-4 w-4 text-red-600" />;
  return <Circle className="h-4 w-4 text-slate-300" />;
}

const rowTint: Record<AgentDisplay["status"], string> = {
  waiting: "border-slate-200 bg-white",
  investigating: "border-cyan-200 bg-cyan-50/60",
  complete: "border-slate-200 bg-white",
  failed: "border-red-200 bg-red-50/40",
};

export function AgentWarRoom({ agents, loading, elapsedMs, mode }: AgentWarRoomProps) {
  const completed = agents.filter((agent) => agent.status === "complete").length;
  const total = agents.length;
  const progress = total ? Math.round((completed / total) * 100) : 0;

  return (
    <Panel
      title="Agent War Room"
      subtitle="Eight specialized agents reconstruct, debate, and safety-check the repair decision."
      icon={<Users className="h-4 w-4" />}
      accent="brand"
      trailing={<StatusBadge value={mode ?? (loading ? "running" : "idle")} dot={loading || !!mode} />}
      bodyClassName="p-5"
    >
      <div className="mb-4">
        <div className="mb-1.5 flex items-center justify-between text-xs">
          <span className="font-medium text-slate-600">Progress</span>
          <span className="font-mono tabular-nums text-slate-500">
            {completed}/{total} agents - {(elapsedMs / 1000).toFixed(1)}s
          </span>
        </div>
        <div className="relative h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-cyan-700 transition-all duration-500 ease-out" style={{ width: `${progress}%` }} />
          {loading && progress < 100 ? (
            <div className="absolute inset-y-0 left-0 w-1/4 animate-bar-indeterminate rounded-full bg-cyan-400/45" />
          ) : null}
        </div>
      </div>

      <div className="space-y-2">
        {agents.map((agent) => {
          const active = agent.status === "investigating";
          return (
            <article key={agent.id} className={`rounded-lg border p-3.5 transition-colors duration-200 ${rowTint[agent.status]}`}>
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white">
                  <AgentIcon status={agent.status} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <h3 className="text-[13px] font-semibold text-slate-900">{agent.name}</h3>
                    <StatusBadge value={agent.status} tone="status" dot />
                    {typeof agent.confidence === "number" ? <StatusBadge value={`${agent.confidence}%`} /> : null}
                    {agent.severity ? <StatusBadge value={agent.severity} tone="severity" /> : null}
                  </div>
                  <p className="mt-0.5 text-xs leading-5 text-slate-500">{agent.role}</p>
                </div>
              </div>

              {agent.summary ? (
                <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50/70 p-3">
                  <p className="text-xs font-medium leading-5 text-slate-700">{agent.summary}</p>
                  {agent.keyFindings.length ? (
                    <ul className="mt-2 space-y-1">
                      {agent.keyFindings.slice(0, 4).map((finding) => (
                        <li key={finding} className="flex gap-2 font-mono text-[11px] leading-5 text-slate-500">
                          <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-slate-300" />
                          <span className="min-w-0 flex-1">{finding}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : active ? (
                <p className="mt-3 inline-flex items-center gap-2 pl-10 text-xs text-cyan-700">
                  <span className="flex gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-cyan-600 animate-pulse-soft" />
                    <span className="h-1.5 w-1.5 rounded-full bg-cyan-600 animate-pulse-soft [animation-delay:200ms]" />
                    <span className="h-1.5 w-1.5 rounded-full bg-cyan-600 animate-pulse-soft [animation-delay:400ms]" />
                  </span>
                  Analyzing evidence...
                </p>
              ) : null}
            </article>
          );
        })}
      </div>
    </Panel>
  );
}

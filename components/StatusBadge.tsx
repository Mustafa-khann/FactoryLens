import type { AgentStatus, IncidentSeverity, TimelineSeverity } from "@/lib/types";

const statusClasses: Record<AgentStatus, string> = {
  waiting: "border-slate-200 bg-slate-50 text-slate-500",
  investigating: "border-cyan-200 bg-cyan-50 text-cyan-700",
  complete: "border-emerald-200 bg-emerald-50 text-emerald-700",
  failed: "border-red-200 bg-red-50 text-red-700",
};

const severityClasses: Record<IncidentSeverity | TimelineSeverity, string> = {
  low: "border-slate-200 bg-slate-50 text-slate-600",
  medium: "border-blue-200 bg-blue-50 text-blue-700",
  high: "border-amber-200 bg-amber-50 text-amber-700",
  critical: "border-red-200 bg-red-50 text-red-700",
  info: "border-slate-200 bg-slate-50 text-slate-600",
  warning: "border-amber-200 bg-amber-50 text-amber-700",
};

export const dotColor: Record<string, string> = {
  waiting: "bg-slate-400",
  investigating: "bg-cyan-600",
  complete: "bg-emerald-500",
  failed: "bg-red-500",
  low: "bg-slate-400",
  medium: "bg-blue-500",
  high: "bg-amber-500",
  critical: "bg-red-500",
  info: "bg-slate-400",
  warning: "bg-amber-500",
};

interface StatusBadgeProps {
  value: AgentStatus | IncidentSeverity | TimelineSeverity | string;
  tone?: "status" | "severity" | "neutral";
  dot?: boolean;
}

export function StatusBadge({ value, tone = "neutral", dot = false }: StatusBadgeProps) {
  const statusClass = tone === "status" && value in statusClasses ? statusClasses[value as AgentStatus] : "";
  const severityClass = tone === "severity" && value in severityClasses ? severityClasses[value as IncidentSeverity | TimelineSeverity] : "";
  const neutralClass = "border-slate-200 bg-white text-slate-600";
  const pulse = value === "investigating";

  return (
    <span
      className={`inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-full border px-2 text-[11px] font-medium capitalize ${
        statusClass || severityClass || neutralClass
      }`}
    >
      {dot ? <span className={`h-1.5 w-1.5 rounded-full ${dotColor[value] ?? "bg-slate-400"} ${pulse ? "animate-pulse-soft" : ""}`} /> : null}
      {value}
    </span>
  );
}

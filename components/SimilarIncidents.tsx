import { CheckCircle2, History, Lightbulb } from "lucide-react";
import { Panel } from "./ui/Panel";
import { StatusBadge } from "./StatusBadge";
import type { ScoredIncident } from "@/lib/incidentMemory";

interface SimilarIncidentsProps {
  matches: ScoredIncident[];
  /** Whether these priors were actually fed into the live diagnosis. */
  usedInDiagnosis: boolean;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

/**
 * "Seen before" — surfaces past failures similar to the current incident, with how they were resolved.
 * This is the payoff of incident memory: pattern recognition across a site's failure history.
 */
export function SimilarIncidents({ matches, usedInDiagnosis }: SimilarIncidentsProps) {
  if (matches.length === 0) return null;
  const resolvedCount = matches.filter((m) => m.incident.resolution).length;

  return (
    <Panel
      title={`Seen before — ${matches.length} similar ${matches.length === 1 ? "incident" : "incidents"}`}
      subtitle={
        usedInDiagnosis
          ? "Pulled from incident memory and fed into this diagnosis as priors."
          : "Pulled from incident memory. Resolve them to feed future diagnoses."
      }
      icon={<History className="h-4 w-4" />}
      accent="warn"
      trailing={resolvedCount ? <StatusBadge value={`${resolvedCount} resolved`} dot /> : null}
      bodyClassName="space-y-2.5 p-5"
    >
      {matches.map(({ incident, score, reasons }) => (
        <article key={incident.id} className="rounded-lg border border-amber-200 bg-amber-50/50 p-3.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="truncate text-[13px] font-semibold leading-5 text-slate-900">{incident.title}</h3>
              <p className="mt-0.5 text-xs text-slate-500">
                {incident.machineType} · {timeAgo(incident.savedAt)}
              </p>
            </div>
            <span className="shrink-0 rounded-full border border-amber-300 bg-white px-2 py-0.5 text-[11px] font-semibold tabular-nums text-amber-700">
              {Math.round(score * 100)}% match
            </span>
          </div>

          <p className="mt-2 text-xs leading-5 text-slate-600">
            <span className="font-medium text-slate-700">Diagnosed:</span> {incident.diagnosedRootCause}
          </p>

          {incident.resolution ? (
            <div className="mt-2 flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50/70 px-2.5 py-2 text-xs leading-5 text-emerald-900">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
              <span>
                <span className="font-semibold">Resolved by:</span> {incident.resolution.fix}
                {incident.resolution.confirmedRootCause ? (
                  <span className="text-emerald-700/80"> (confirmed: {incident.resolution.confirmedRootCause})</span>
                ) : null}
              </span>
            </div>
          ) : (
            <div className="mt-2 flex items-start gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-2 text-xs leading-5 text-slate-500">
              <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
              <span>Not yet resolved — record the real fix in History to teach future investigations.</span>
            </div>
          )}

          {reasons.length ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {reasons.map((reason) => (
                <span key={reason} className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-500">
                  {reason}
                </span>
              ))}
            </div>
          ) : null}
        </article>
      ))}
    </Panel>
  );
}

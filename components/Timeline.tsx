import { Clock } from "lucide-react";
import type { TimelineEvent } from "@/lib/types";
import { EmptyState, Panel } from "./ui/Panel";
import { StatusBadge } from "./StatusBadge";

interface TimelineProps {
  events: TimelineEvent[];
}

const nodeColor: Record<TimelineEvent["severity"], string> = {
  info: "border-slate-300 bg-white",
  warning: "border-amber-400 bg-amber-100",
  critical: "border-red-400 bg-red-100",
};

export function Timeline({ events }: TimelineProps) {
  return (
    <Panel title="Failure Timeline" subtitle="Reconstructed sequence of events." icon={<Clock className="h-4 w-4" />}>
      {events.length ? (
        <ol className="relative space-y-5 pl-5">
          <span aria-hidden className="absolute bottom-2 left-[5px] top-2 w-px bg-slate-200" />
          {events.map((event, index) => (
            <li key={`${event.timestamp}-${index}`} className="relative">
              <span className={`absolute -left-5 top-1 h-[11px] w-[11px] rounded-full border-2 ${nodeColor[event.severity]}`} />
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs font-semibold tabular-nums text-slate-700">{event.timestamp}</span>
                <StatusBadge value={event.severity} tone="severity" dot />
              </div>
              <p className="mt-1 text-[13px] leading-5 text-slate-800">{event.event}</p>
              <p className="mt-0.5 text-[11px] text-slate-400">{event.source}</p>
            </li>
          ))}
        </ol>
      ) : (
        <EmptyState>Timeline will populate after the investigation runs.</EmptyState>
      )}
    </Panel>
  );
}

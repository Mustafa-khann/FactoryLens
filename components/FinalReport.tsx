import { AlertTriangle, ClipboardCheck, FlaskConical, HelpCircle, Target, Wrench } from "lucide-react";
import type { ReactNode } from "react";
import type { FinalReport as FinalReportData } from "@/lib/types";
import { EmptyState, Panel } from "./ui/Panel";
import { StatusBadge } from "./StatusBadge";

interface FinalReportProps {
  report?: FinalReportData;
}

function ListBlock({ title, items, icon, danger }: { title: string; items: string[]; icon: ReactNode; danger?: boolean }) {
  return (
    <div>
      <h3 className="flex items-center gap-2 text-xs font-semibold text-slate-700">
        <span className={danger ? "text-amber-600" : "text-slate-400"}>{icon}</span>
        {title}
      </h3>
      <ul className="mt-2.5 space-y-1.5 text-[13px] leading-5 text-slate-700">
        {items.length ? (
          items.map((item) => (
            <li key={item} className={`rounded-lg border px-3 py-2 ${danger ? "border-amber-200 bg-amber-50/60" : "border-slate-200 bg-slate-50/60"}`}>
              {item}
            </li>
          ))
        ) : (
          <li className="rounded-lg border border-dashed border-slate-200 px-3 py-2 text-slate-400">None reported.</li>
        )}
      </ul>
    </div>
  );
}

export function FinalReport({ report }: FinalReportProps) {
  return (
    <Panel
      title="Incident Commander Report"
      subtitle="The final safety-aware repair decision."
      icon={<ClipboardCheck className="h-4 w-4" />}
      accent="brand"
      trailing={report ? <StatusBadge value={`${report.confidenceLevel} confidence`} dot /> : null}
    >
      {report ? (
        <div className="space-y-5">
          <div className="rounded-lg border border-cyan-200 bg-cyan-50/70 p-4">
            <h3 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-label text-cyan-800">
              <Target className="h-3.5 w-3.5" />
              Most likely root cause
            </h3>
            <p className="mt-1.5 text-base font-semibold leading-6 text-slate-900">{report.mostLikelyRootCause}</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-4">
              <h3 className="text-xs font-semibold text-slate-700">Executive summary</h3>
              <p className="mt-1.5 text-[13px] leading-6 text-slate-600">{report.executiveSummary}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-4">
              <h3 className="text-xs font-semibold text-slate-700">Recommended next action</h3>
              <p className="mt-1.5 text-[13px] leading-6 text-slate-600">{report.recommendedNextAction}</p>
            </div>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <ListBlock title="Evidence" items={report.evidence} icon={<ClipboardCheck className="h-3.5 w-3.5" />} />
            <ListBlock title="Immediate diagnostic steps" items={report.immediateDiagnosticSteps} icon={<FlaskConical className="h-3.5 w-3.5" />} />
            <ListBlock title="Repair plan" items={report.repairPlan} icon={<Wrench className="h-3.5 w-3.5" />} />
            <ListBlock title="Safety warnings" items={report.safetyWarnings} icon={<AlertTriangle className="h-3.5 w-3.5" />} danger />
            <ListBlock title="Missing data" items={report.missingData} icon={<HelpCircle className="h-3.5 w-3.5" />} />
            <ListBlock title="Human escalation criteria" items={report.humanEscalationCriteria} icon={<AlertTriangle className="h-3.5 w-3.5" />} danger />
          </div>
        </div>
      ) : (
        <EmptyState icon={<ClipboardCheck className="h-4 w-4" />} title="No report yet">
          Run an investigation to generate the final repair decision.
        </EmptyState>
      )}
    </Panel>
  );
}

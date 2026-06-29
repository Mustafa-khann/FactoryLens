import { ArrowRight, ListOrdered, ShieldQuestion, TrendingDown } from "lucide-react";
import type { Hypothesis, SkepticReview } from "@/lib/types";
import { EmptyState, Panel } from "./ui/Panel";

interface HypothesisBattleProps {
  hypotheses: Hypothesis[];
  skepticReview?: SkepticReview;
}

function confidenceColor(value: number) {
  if (value >= 70) return "bg-emerald-500";
  if (value >= 40) return "bg-amber-500";
  return "bg-red-500";
}

function SkepticBanner({ review }: { review: SkepticReview }) {
  const dropped = review.confidenceAfter < review.confidenceBefore;
  return (
    <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50/70 p-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="flex items-center gap-2 text-xs font-semibold text-amber-800">
          <ShieldQuestion className="h-4 w-4" />
          Skeptic agent review
        </h3>
        {dropped ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-white px-2 py-0.5 text-xs font-semibold text-amber-700">
            <TrendingDown className="h-3.5 w-3.5" />
            <span className="font-mono tabular-nums">{review.confidenceBefore}%</span>
            <ArrowRight className="h-3 w-3 text-amber-400" />
            <span className="font-mono tabular-nums">{review.confidenceAfter}%</span>
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-[13px] leading-5 text-amber-900">{review.overallAssessment}</p>
      {review.critique.length ? (
        <ul className="mt-2 space-y-1">
          {review.critique.map((point) => (
            <li key={point} className="flex gap-2 text-xs leading-5 text-amber-800">
              <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-amber-500" />
              <span>{point}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function HypothesisBattle({ hypotheses, skepticReview }: HypothesisBattleProps) {
  return (
    <Panel
      title="Ranked Hypotheses"
      subtitle="Synthesized by the agents, then stress-tested by the Skeptic."
      icon={<ListOrdered className="h-4 w-4" />}
      bodyClassName="p-5"
    >
      {hypotheses.length ? (
        <>
          {skepticReview ? <SkepticBanner review={skepticReview} /> : null}
          <div className="-mx-5 overflow-x-auto px-5 thin-scrollbar">
            <table className="w-full min-w-[860px] border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-[11px] font-medium text-slate-500">
                  <th className="w-10 py-2.5 pr-3">#</th>
                  <th className="py-2.5 pr-3">Hypothesis</th>
                  <th className="py-2.5 pr-3">Evidence For</th>
                  <th className="py-2.5 pr-3">Evidence Against</th>
                  <th className="w-32 py-2.5 pr-3">Confidence</th>
                  <th className="py-2.5 pr-3">Test</th>
                  <th className="py-2.5">Falsification</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {hypotheses.map((hypothesis) => {
                  const confidence = Math.max(0, Math.min(100, hypothesis.confidence));
                  const revised = typeof hypothesis.priorConfidence === "number" && hypothesis.priorConfidence !== hypothesis.confidence;
                  return (
                    <tr key={`${hypothesis.rank}-${hypothesis.hypothesis}`} className="align-top hover:bg-slate-50/60">
                      <td className="py-3.5 pr-3">
                        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-slate-100 font-mono text-[11px] font-semibold text-slate-700">
                          {hypothesis.rank}
                        </span>
                      </td>
                      <td className="py-3.5 pr-3 font-semibold leading-5 text-slate-900">{hypothesis.hypothesis}</td>
                      <td className="py-3.5 pr-3 leading-5 text-slate-600">
                        <span className="border-l-2 border-emerald-300 pl-2">{hypothesis.evidenceFor.join(" ")}</span>
                      </td>
                      <td className="py-3.5 pr-3 leading-5 text-slate-500">
                        <span className="border-l-2 border-red-300 pl-2">{hypothesis.evidenceAgainst.join(" ")}</span>
                      </td>
                      <td className="py-3.5 pr-3">
                        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100">
                          <div className={`h-full rounded-full ${confidenceColor(confidence)}`} style={{ width: `${confidence}%` }} />
                        </div>
                        <span className="mt-1 flex items-center gap-1 font-mono text-[11px] tabular-nums text-slate-500">
                          {revised ? (
                            <>
                              <span className="text-slate-400 line-through">{hypothesis.priorConfidence}%</span>
                              <ArrowRight className="h-3 w-3 text-amber-400" />
                            </>
                          ) : null}
                          <span className={revised ? "font-semibold text-amber-700" : ""}>{hypothesis.confidence}%</span>
                        </span>
                      </td>
                      <td className="py-3.5 pr-3 leading-5 text-slate-600">{hypothesis.recommendedTest}</td>
                      <td className="py-3.5 leading-5 text-slate-500">{hypothesis.falsificationSignal}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <EmptyState>Hypotheses will populate after the investigation runs.</EmptyState>
      )}
    </Panel>
  );
}

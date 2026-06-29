import { ArrowDown, Share2 } from "lucide-react";
import type { EvidenceGraphEdge, EvidenceGraphNode } from "@/lib/types";
import { EmptyState, Panel } from "./ui/Panel";

interface EvidenceGraphProps {
  nodes: EvidenceGraphNode[];
  edges: EvidenceGraphEdge[];
}

const typeStyles: Record<EvidenceGraphNode["type"], { tile: string; chip: string }> = {
  log: { tile: "border-slate-200 bg-white", chip: "bg-slate-100 text-slate-600" },
  config: { tile: "border-blue-200 bg-blue-50/50", chip: "bg-blue-100 text-blue-700" },
  note: { tile: "border-violet-200 bg-violet-50/50", chip: "bg-violet-100 text-violet-700" },
  image: { tile: "border-teal-200 bg-teal-50/50", chip: "bg-teal-100 text-teal-700" },
  inference: { tile: "border-cyan-200 bg-cyan-50/60", chip: "bg-cyan-100 text-cyan-800" },
  fault: { tile: "border-red-200 bg-red-50/60", chip: "bg-red-100 text-red-700" },
};

export function EvidenceGraph({ nodes, edges }: EvidenceGraphProps) {
  const edgeLabel = (from: string, to: string) => edges.find((edge) => edge.from === from && edge.to === to)?.label;

  return (
    <Panel title="Evidence Graph" subtitle="Evidence linked to inferences and candidate faults." icon={<Share2 className="h-4 w-4" />}>
      {nodes.length ? (
        <div className="space-y-1">
          {nodes.map((node, index) => {
            const next = nodes[index + 1];
            const style = typeStyles[node.type] ?? typeStyles.log;
            return (
              <div key={node.id}>
                <div className={`rounded-lg border p-3 ${style.tile}`}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[13px] font-medium leading-5 text-slate-800">{node.label}</p>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-label ${style.chip}`}>{node.type}</span>
                  </div>
                </div>
                {next ? (
                  <div className="flex items-center gap-2 py-1 pl-3 text-[11px] text-slate-400">
                    <ArrowDown className="h-3.5 w-3.5 text-slate-300" />
                    <span className="font-mono">{edgeLabel(node.id, next.id) ?? "supports"}</span>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState>Evidence graph will populate after the investigation runs.</EmptyState>
      )}
    </Panel>
  );
}

import { Camera, Eye, ImageIcon } from "lucide-react";
import type { ImageEvidenceMeta, InvestigationMode, VisionObservations } from "@/lib/types";
import { Panel } from "./ui/Panel";
import { StatusBadge } from "./StatusBadge";

interface ImageEvidencePanelProps {
  image: ImageEvidenceMeta;
  mode?: InvestigationMode;
  loading: boolean;
  vision?: VisionObservations;
}

function formatBytes(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
      <p className="text-[11px] font-medium text-slate-500">{label}</p>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function FindingList({ icon, title, items, tint }: { icon: React.ReactNode; title: string; items: string[]; tint: string }) {
  if (!items.length) return null;
  return (
    <div>
      <h3 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-label text-slate-500">
        <span className={tint}>{icon}</span>
        {title}
      </h3>
      <ul className="mt-2 space-y-1.5">
        {items.map((item) => (
          <li key={item} className="flex gap-2 text-[13px] leading-5 text-slate-700">
            <span className={`mt-[7px] h-1 w-1 shrink-0 rounded-full ${tint.replace("text-", "bg-")}`} />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ImageEvidencePanel({ image, mode, loading, vision }: ImageEvidencePanelProps) {
  const sentToGemma = image.included && mode === "live";
  const sentValue = loading && image.included ? "pending" : sentToGemma ? "yes" : mode === "mock" && image.included ? "simulated" : "no";

  return (
    <Panel
      title="Vision Inspector"
      subtitle="A dedicated multimodal Gemma 4 agent reads the equipment photo."
      icon={<Eye className="h-4 w-4" />}
      accent={image.included ? "brand" : "default"}
      bodyClassName="space-y-4 p-5"
    >
      {image.included && image.dataUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image.dataUrl} alt="Uploaded equipment evidence" className="max-h-56 w-full rounded-lg border border-slate-200 object-contain bg-slate-50" />
      ) : null}

      <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <Cell label="Image included">
          <StatusBadge value={image.included ? "yes" : "no"} dot />
        </Cell>
        <Cell label="Sent to model">
          <span className="font-mono text-slate-800">{sentValue}</span>
        </Cell>
        <Cell label="Format">
          <p className="truncate font-mono text-slate-800">{image.format?.replace("image/", "") || "-"}</p>
        </Cell>
        <Cell label="Size">
          <p className="font-mono tabular-nums text-slate-800">{formatBytes(image.sizeBytes)}</p>
        </Cell>
      </div>

      {vision ? (
        <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
          {vision.conditionSummary ? (
            <div className="flex items-start gap-2.5">
              <ImageIcon className="mt-0.5 h-4 w-4 shrink-0 text-cyan-700" />
              <p className="text-[13px] font-medium leading-5 text-slate-800">{vision.conditionSummary}</p>
            </div>
          ) : null}
          <FindingList icon={<Eye className="h-3.5 w-3.5" />} title="Visible observations" items={vision.observations} tint="text-cyan-700" />
          <FindingList icon={<Camera className="h-3.5 w-3.5" />} title="Evidence to collect" items={vision.requestedEvidence} tint="text-slate-400" />
        </div>
      ) : null}
    </Panel>
  );
}

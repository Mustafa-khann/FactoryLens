"use client";

import { FileText, ImagePlus, Shuffle, Sparkles, X } from "lucide-react";
import type { ImageEvidenceMeta, Incident, IncidentSeverity } from "@/lib/types";
import { Panel } from "./ui/Panel";
import { Button } from "./ui/Button";
import { StatusBadge } from "./StatusBadge";

interface IncidentInputProps {
  incident: Incident;
  setIncident: (incident: Incident) => void;
  image: ImageEvidenceMeta;
  onImageChange: (image: ImageEvidenceMeta) => void;
  demoCases: Incident[];
  onSelectDemo: (id: string) => void;
  onGenerateSynthetic: (machineType?: string) => void;
  loading: boolean;
}

const supportedMachineTypes = ["robotic arm", "conveyor", "autonomous rover", "drone", "CNC spindle", "packaging line", "pump/motor system"];

const inputClass =
  "w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-[13px] text-slate-900 shadow-sm outline-none transition-colors placeholder:text-slate-400 hover:border-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

const textareaClass = `${inputClass} min-h-[112px] resize-y font-mono text-xs leading-5 thin-scrollbar`;

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-700">{label}</span>
        {hint ? <span className="font-mono text-[11px] text-slate-400">{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read image file."));
    reader.readAsDataURL(file);
  });
}

export function IncidentInput({
  incident,
  setIncident,
  image,
  onImageChange,
  demoCases,
  onSelectDemo,
  onGenerateSynthetic,
  loading,
}: IncidentInputProps) {
  const update = <K extends keyof Incident,>(key: K, value: Incident[K]) => setIncident({ ...incident, [key]: value });

  async function handleImage(file?: File) {
    if (!file) {
      onImageChange({ included: false });
      setIncident({ ...incident, imageName: undefined });
      return;
    }
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      onImageChange({ included: false });
      setIncident({ ...incident, imageName: undefined });
      return;
    }
    const dataUrl = await readFileAsDataUrl(file);
    onImageChange({ included: true, name: file.name, format: file.type, sizeBytes: file.size, dataUrl });
    setIncident({ ...incident, imageName: file.name });
  }

  return (
    <Panel
      title="Incident"
      subtitle="Configure the evidence to investigate."
      icon={<FileText className="h-4 w-4" />}
      trailing={<StatusBadge value={incident.severity} tone="severity" dot />}
      bodyClassName="p-0"
    >
      <fieldset disabled={loading} className="min-w-0 divide-y divide-slate-100 disabled:opacity-60">
        {/* Quick-start */}
        <div className="space-y-3 bg-slate-50/60 p-5">
          <Field label="Demo incident">
            <select className={inputClass} value={incident.id.startsWith("demo-") ? incident.id : ""} onChange={(event) => onSelectDemo(event.target.value)}>
              <option value="" disabled>
                Select a demo case…
              </option>
              {demoCases.map((demo) => (
                <option key={demo.id} value={demo.id}>
                  {demo.incidentTitle}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Or generate a synthetic incident">
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <select className={inputClass} defaultValue={incident.machineType.toLowerCase()}>
                {supportedMachineTypes.map((machineType) => (
                  <option key={machineType} value={machineType}>
                    {machineType}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="secondary"
                onClick={(event) => {
                  const select = event.currentTarget.parentElement?.querySelector("select");
                  onGenerateSynthetic(select?.value);
                }}
              >
                <Shuffle className="h-4 w-4" />
                Generate
              </Button>
            </div>
          </Field>
        </div>

        {/* Details */}
        <div className="space-y-4 p-5">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.7fr)]">
            <Field label="Incident title">
              <input className={inputClass} value={incident.incidentTitle} onChange={(event) => update("incidentTitle", event.target.value)} />
            </Field>
            <Field label="Machine type">
              <input className={inputClass} value={incident.machineType} onChange={(event) => update("machineType", event.target.value)} />
            </Field>
          </div>

          <Field label="Severity">
            <select className={inputClass} value={incident.severity} onChange={(event) => update("severity", event.target.value as IncidentSeverity)}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </Field>

          <Field label="Logs" hint={`${incident.logs.split("\n").filter(Boolean).length} rows`}>
            <textarea className={textareaClass} value={incident.logs} onChange={(event) => update("logs", event.target.value)} spellCheck={false} />
          </Field>

          <Field label="Code / config">
            <textarea className={textareaClass} value={incident.config} onChange={(event) => update("config", event.target.value)} spellCheck={false} />
          </Field>

          <Field label="Maintenance notes">
            <textarea className={textareaClass} value={incident.maintenanceNotes} onChange={(event) => update("maintenanceNotes", event.target.value)} />
          </Field>

          <Field label="Operator notes">
            <textarea className={textareaClass} value={incident.operatorNotes} onChange={(event) => update("operatorNotes", event.target.value)} />
          </Field>

          <Field label="Image evidence">
            <div className="space-y-2 rounded-lg border border-slate-300 bg-white px-3 py-2.5 shadow-sm">
              <div className="flex items-center gap-2">
                <ImagePlus className={`h-4 w-4 shrink-0 ${image.included ? "text-brand-600" : "text-slate-400"}`} />
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="min-w-0 flex-1 text-xs text-slate-600 file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-slate-100 file:px-2.5 file:py-1 file:text-xs file:font-medium file:text-slate-700 hover:file:bg-slate-200"
                  onChange={(event) => void handleImage(event.target.files?.[0])}
                />
                {image.included ? (
                  <button
                    type="button"
                    onClick={() => handleImage(undefined)}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-400 transition-colors hover:border-red-200 hover:text-red-600"
                    title="Clear image evidence"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
              <p className="flex items-center gap-1.5 truncate text-[11px] text-slate-400">
                {!image.included ? <Sparkles className="h-3 w-3 shrink-0" /> : null}
                <span className="truncate">{image.included ? image.name : "Optional — Vision Inspector will request visual evidence if omitted."}</span>
              </p>
            </div>
          </Field>
        </div>
      </fieldset>
    </Panel>
  );
}

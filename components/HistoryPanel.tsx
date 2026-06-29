"use client";

import { useState } from "react";
import { CheckCircle2, History, Pencil, Trash2, X } from "lucide-react";
import { Button } from "./ui/Button";
import { EmptyState, Panel } from "./ui/Panel";
import { StatusBadge } from "./StatusBadge";
import type { SavedIncident } from "@/lib/incidentMemory";

interface HistoryPanelProps {
  incidents: SavedIncident[];
  onResolve: (id: string, resolution: { confirmedRootCause: string; fix: string }) => void;
  onClearResolution: (id: string) => void;
  onDelete: (id: string) => void;
  onClearAll: () => void;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

function ResolutionEditor({
  incident,
  onSave,
  onCancel,
}: {
  incident: SavedIncident;
  onSave: (resolution: { confirmedRootCause: string; fix: string }) => void;
  onCancel: () => void;
}) {
  const [confirmedRootCause, setConfirmedRootCause] = useState(incident.resolution?.confirmedRootCause ?? incident.diagnosedRootCause);
  const [fix, setFix] = useState(incident.resolution?.fix ?? "");
  const canSave = confirmedRootCause.trim().length > 0 && fix.trim().length > 0;

  return (
    <div className="mt-3 space-y-2.5 rounded-lg border border-slate-200 bg-slate-50/70 p-3">
      <div>
        <label className="text-[11px] font-medium text-slate-600">Confirmed root cause</label>
        <input
          value={confirmedRootCause}
          onChange={(event) => setConfirmedRootCause(event.target.value)}
          placeholder="What it actually was"
          className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-[13px] text-slate-800 outline-none focus:border-brand-400"
        />
      </div>
      <div>
        <label className="text-[11px] font-medium text-slate-600">Fix that worked</label>
        <input
          value={fix}
          onChange={(event) => setFix(event.target.value)}
          placeholder="The action that closed the ticket"
          className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-[13px] text-slate-800 outline-none focus:border-brand-400"
        />
      </div>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="primary"
          size="sm"
          disabled={!canSave}
          onClick={() => onSave({ confirmedRootCause: confirmedRootCause.trim(), fix: fix.trim() })}
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          Save resolution
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/**
 * Incident history — the persistent memory browser. Lets a tech record how each incident was actually
 * resolved, which is exactly what future "seen before" matches learn from.
 */
export function HistoryPanel({ incidents, onResolve, onClearResolution, onDelete, onClearAll }: HistoryPanelProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const resolvedCount = incidents.filter((item) => item.resolution).length;

  return (
    <Panel
      title="Incident History"
      subtitle="Every investigation is saved locally and powers future pattern matching."
      icon={<History className="h-4 w-4" />}
      trailing={
        incidents.length ? (
          <div className="flex items-center gap-2">
            <StatusBadge value={`${resolvedCount}/${incidents.length} resolved`} dot />
            <Button type="button" variant="ghost" size="sm" onClick={onClearAll}>
              <Trash2 className="h-3.5 w-3.5" />
              Clear all
            </Button>
          </div>
        ) : null
      }
      bodyClassName="space-y-2.5 p-5"
    >
      {incidents.length === 0 ? (
        <EmptyState icon={<History className="h-4 w-4" />} title="No saved incidents yet">
          Run an investigation and it will be saved here. Once you have a few, FactoryLens starts recognising repeat failures.
        </EmptyState>
      ) : (
        incidents.map((incident) => (
          <article key={incident.id} className="rounded-lg border border-slate-200 bg-white p-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate text-[13px] font-semibold leading-5 text-slate-900">{incident.title}</h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  {incident.machineType} · {formatDate(incident.savedAt)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <StatusBadge value={incident.severity} tone="severity" dot />
                <button
                  type="button"
                  onClick={() => setEditingId(editingId === incident.id ? null : incident.id)}
                  className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                  aria-label="Record resolution"
                  title="Record how this was resolved"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(incident.id)}
                  className="rounded-md p-1 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
                  aria-label="Delete incident"
                  title="Delete from history"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <p className="mt-2 text-xs leading-5 text-slate-600">
              <span className="font-medium text-slate-700">Diagnosed ({incident.confidenceLevel}):</span> {incident.diagnosedRootCause}
            </p>

            {incident.resolution ? (
              <div className="mt-2 flex items-start justify-between gap-2 rounded-md border border-emerald-200 bg-emerald-50/70 px-2.5 py-2">
                <div className="flex items-start gap-2 text-xs leading-5 text-emerald-900">
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                  <span>
                    <span className="font-semibold">Resolved:</span> {incident.resolution.fix}
                    {incident.resolution.confirmedRootCause ? (
                      <span className="text-emerald-700/80"> (confirmed: {incident.resolution.confirmedRootCause})</span>
                    ) : null}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => onClearResolution(incident.id)}
                  className="shrink-0 rounded p-0.5 text-emerald-500 transition-colors hover:bg-emerald-100 hover:text-emerald-700"
                  aria-label="Clear resolution"
                  title="Mark as unresolved"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : null}

            {editingId === incident.id ? (
              <ResolutionEditor
                incident={incident}
                onSave={(resolution) => {
                  onResolve(incident.id, resolution);
                  setEditingId(null);
                }}
                onCancel={() => setEditingId(null)}
              />
            ) : null}
          </article>
        ))
      )}
    </Panel>
  );
}

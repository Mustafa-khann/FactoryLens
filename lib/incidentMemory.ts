/**
 * Incident memory — a client-side knowledge base that makes FactoryLens compound in value.
 *
 * Every completed investigation is saved to the browser (no backend, stays Vercel-deployable).
 * When a new incident comes in, we surface the most similar past failures and — crucially —
 * how they were actually resolved, so the war room can recognise a pattern it has seen before.
 *
 * This is deliberately dependency-free and SSR-safe: every storage call is guarded so the module
 * can be imported anywhere without touching `window` during server rendering.
 */
import type { AnalysisResponse, Incident, IncidentSeverity, PriorIncidentContext } from "./types";

const STORAGE_KEY = "factorylens.incidents.v1";
const MAX_ENTRIES = 60;

/** How a confirmed incident was actually resolved — the ground truth a tech records after the fix. */
export interface MemoryResolution {
  /** The real, confirmed root cause once the fix was applied. */
  confirmedRootCause: string;
  /** What actually fixed it (the action that closed the ticket). */
  fix: string;
  resolvedAt: string;
}

/** One investigation, persisted for recall. Kept compact — we don't store the full agent transcript. */
export interface SavedIncident {
  id: string;
  savedAt: string;
  title: string;
  machineType: string;
  severity: IncidentSeverity;
  /** What the war room concluded for this incident. */
  diagnosedRootCause: string;
  confidenceLevel: "low" | "medium" | "high";
  executiveSummary: string;
  /** Precomputed search signal so similarity scoring stays cheap on every keystroke. */
  keywords: string[];
  /** Present once a human confirms what it really was — this is what makes memory trustworthy. */
  resolution?: MemoryResolution;
}

/** A past incident plus how well it matches the one on screen now. */
export interface ScoredIncident {
  incident: SavedIncident;
  /** 0–1 content-similarity score. */
  score: number;
  /** Human-readable reasons the two line up (machine match, shared alarm codes, …). */
  reasons: string[];
}

// --- Keyword extraction ----------------------------------------------------

const STOPWORDS = new Set([
  "the","a","an","and","or","but","of","to","in","on","at","for","with","is","are","was","were","be","been",
  "this","that","these","those","it","its","as","by","from","into","than","then","there","here","not","no",
  "after","before","during","while","when","which","what","has","have","had","will","would","should","could",
  "incident","machine","system","unit","error","issue","fault","failure","alarm","detected","reported","observed",
]);

/** Domain-aware tokeniser: keeps alarm codes / part numbers (anything with a digit) and meaningful words. */
function tokenize(text: string): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => {
      if (token.length < 3) return false;
      if (/\d/.test(token)) return true; // alarm codes, part numbers, error numbers are high-signal
      return !STOPWORDS.has(token);
    });
}

/** Build the de-duplicated keyword signal for an incident (title + machine + free-text evidence). */
export function extractKeywords(incident: Incident, diagnosedRootCause = ""): string[] {
  const corpus = [
    incident.incidentTitle,
    incident.machineType,
    incident.logs,
    incident.maintenanceNotes,
    incident.operatorNotes,
    diagnosedRootCause,
  ].join(" ");
  return Array.from(new Set(tokenize(corpus)));
}

// --- Similarity ------------------------------------------------------------

function machineWords(machineType: string): Set<string> {
  return new Set(tokenize(machineType));
}

/** Fraction of the query's machine-type words also present in the candidate's (handles "ABB IRB 6700" vs "ABB robot"). */
function machineOverlap(a: string, b: string): number {
  const wa = machineWords(a);
  const wb = machineWords(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  let shared = 0;
  wa.forEach((w) => {
    if (wb.has(w)) shared += 1;
  });
  return shared / Math.max(wa.size, wb.size);
}

/** Jaccard overlap of two keyword sets. */
function keywordOverlap(a: string[], b: string[]): { ratio: number; shared: string[] } {
  if (a.length === 0 || b.length === 0) return { ratio: 0, shared: [] };
  const setB = new Set(b);
  const shared = a.filter((token) => setB.has(token));
  const union = new Set([...a, ...b]).size;
  return { ratio: union ? shared.length / union : 0, shared };
}

const SIMILARITY_THRESHOLD = 0.12;

/**
 * Score saved incidents against the one currently on screen.
 * Weighted blend of keyword overlap, machine-type match, and severity — tuned so a shared
 * alarm code on the same machine reliably floats to the top.
 */
export function findSimilarIncidents(
  query: Incident,
  saved: SavedIncident[],
  options: { diagnosedRootCause?: string; excludeId?: string; limit?: number } = {},
): ScoredIncident[] {
  const { diagnosedRootCause = "", excludeId, limit = 3 } = options;
  const queryKeywords = extractKeywords(query, diagnosedRootCause);

  const scored = saved
    .filter((item) => item.id !== excludeId)
    .map((item): ScoredIncident => {
      const { ratio, shared } = keywordOverlap(queryKeywords, item.keywords);
      const machine = machineOverlap(query.machineType, item.machineType);
      const severityMatch = query.severity === item.severity ? 1 : 0;

      const score = 0.6 * ratio + 0.28 * machine + 0.12 * severityMatch;

      const reasons: string[] = [];
      if (machine >= 0.99) reasons.push(`Same machine type (${item.machineType})`);
      else if (machine > 0) reasons.push("Related machine type");
      if (severityMatch) reasons.push(`Same severity (${item.severity})`);
      const signalTerms = shared.filter((token) => /\d/.test(token)).slice(0, 4);
      if (signalTerms.length) reasons.push(`Shared signals: ${signalTerms.join(", ")}`);
      else if (shared.length) reasons.push(`Shared terms: ${shared.slice(0, 4).join(", ")}`);

      return { incident: item, score, reasons };
    })
    .filter((entry) => entry.score >= SIMILARITY_THRESHOLD)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, limit);
}

/** Convert a scored match into the compact prior the live pipeline consumes. */
export function toPriorContext(match: ScoredIncident): PriorIncidentContext {
  return {
    title: match.incident.title,
    machineType: match.incident.machineType,
    severity: match.incident.severity,
    diagnosedRootCause: match.incident.diagnosedRootCause,
    confirmedRootCause: match.incident.resolution?.confirmedRootCause,
    resolvedFix: match.incident.resolution?.fix,
  };
}

// --- Persistence (SSR-safe) ------------------------------------------------

function getStore(): Storage | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null; // private mode / storage disabled
  }
}

export function loadIncidents(): SavedIncident[] {
  const store = getStore();
  if (!store) return [];
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSavedIncident);
  } catch {
    return [];
  }
}

function persist(incidents: SavedIncident[]): SavedIncident[] {
  const store = getStore();
  const trimmed = incidents.slice(0, MAX_ENTRIES);
  if (!store) return trimmed;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // Quota or disabled storage — memory simply won't persist this session.
  }
  return trimmed;
}

function isSavedIncident(value: unknown): value is SavedIncident {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as SavedIncident).id === "string" &&
    typeof (value as SavedIncident).title === "string" &&
    typeof (value as SavedIncident).machineType === "string" &&
    Array.isArray((value as SavedIncident).keywords)
  );
}

function makeId(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return `inc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Save a completed investigation to memory. De-duplicates against a recent identical run
 * (same machine + diagnosed root cause within a short window) so re-running doesn't spam history.
 * Returns the updated list and the id of the saved entry.
 */
export function saveInvestigation(
  incident: Incident,
  analysis: AnalysisResponse,
): { incidents: SavedIncident[]; savedId: string } {
  const report = analysis.result.finalReport;
  const diagnosedRootCause = report?.mostLikelyRootCause ?? "Undetermined";
  const existing = loadIncidents();

  const entry: SavedIncident = {
    id: makeId(),
    savedAt: new Date().toISOString(),
    title: incident.incidentTitle,
    machineType: incident.machineType,
    severity: incident.severity,
    diagnosedRootCause,
    confidenceLevel: report?.confidenceLevel ?? "low",
    executiveSummary: report?.executiveSummary ?? "",
    keywords: extractKeywords(incident, diagnosedRootCause),
  };

  const recentDuplicate = existing.find(
    (item) =>
      item.machineType === entry.machineType &&
      item.diagnosedRootCause === entry.diagnosedRootCause &&
      Date.now() - new Date(item.savedAt).getTime() < 60_000,
  );
  if (recentDuplicate) {
    return { incidents: existing, savedId: recentDuplicate.id };
  }

  const incidents = persist([entry, ...existing]);
  return { incidents, savedId: entry.id };
}

/** Record (or update) how an incident was actually resolved — this is what future matches learn from. */
export function recordResolution(id: string, resolution: Omit<MemoryResolution, "resolvedAt">): SavedIncident[] {
  const incidents = loadIncidents().map((item) =>
    item.id === id
      ? { ...item, resolution: { ...resolution, resolvedAt: new Date().toISOString() } }
      : item,
  );
  return persist(incidents);
}

/** Remove a recorded resolution, reverting the incident to unresolved. */
export function clearResolution(id: string): SavedIncident[] {
  const incidents = loadIncidents().map((item) => {
    if (item.id !== id) return item;
    const { resolution: _resolution, ...rest } = item;
    return rest;
  });
  return persist(incidents);
}

export function deleteIncident(id: string): SavedIncident[] {
  return persist(loadIncidents().filter((item) => item.id !== id));
}

export function clearAllIncidents(): SavedIncident[] {
  return persist([]);
}

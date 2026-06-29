import { NextResponse } from "next/server";
import { CerebrasError } from "@/lib/cerebras";
import { createMockInvestigation } from "@/lib/mockInvestigation";
import { runInvestigationPipeline } from "@/lib/orchestrator";
import type { Incident, PriorIncidentContext } from "@/lib/types";

export const runtime = "nodejs";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIncident(value: unknown): value is Incident {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.incidentTitle === "string" &&
    typeof value.machineType === "string" &&
    typeof value.severity === "string" &&
    typeof value.logs === "string" &&
    typeof value.config === "string" &&
    typeof value.maintenanceNotes === "string" &&
    typeof value.operatorNotes === "string" &&
    Array.isArray(value.timestampedEvents)
  );
}

function isImageDataUrl(value: unknown): value is string {
  return typeof value === "string" && /^data:image\/(png|jpeg|jpg|webp);base64,/i.test(value);
}

/** Sanitize the prior-incident context retrieved from the client's local memory before it reaches the model. */
function parsePriorIncidents(value: unknown): PriorIncidentContext[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const clip = (text: unknown, max: number) => (typeof text === "string" ? text.slice(0, max) : "");
  const priors = value
    .filter(isRecord)
    .slice(0, 5)
    .map((item): PriorIncidentContext => ({
      title: clip(item.title, 200),
      machineType: clip(item.machineType, 120),
      severity: (["low", "medium", "high", "critical"].includes(item.severity as string)
        ? item.severity
        : "medium") as PriorIncidentContext["severity"],
      diagnosedRootCause: clip(item.diagnosedRootCause, 400),
      confirmedRootCause: typeof item.confirmedRootCause === "string" ? clip(item.confirmedRootCause, 400) : undefined,
      resolvedFix: typeof item.resolvedFix === "string" ? clip(item.resolvedFix, 400) : undefined,
    }))
    .filter((prior) => prior.title && prior.machineType);
  return priors.length ? priors : undefined;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as unknown;
    if (!isRecord(body) || !isIncident(body.incident)) {
      return NextResponse.json({ error: "Invalid incident payload" }, { status: 400 });
    }

    const incident = body.incident;
    const imageDataUrl = isImageDataUrl(body.imageDataUrl) ? body.imageDataUrl : undefined;
    const priorIncidents = parsePriorIncidents(body.priorIncidents);

    // Demo mode is an explicit, user-chosen path that returns clearly-labeled sample
    // data. Real analysis NEVER silently falls back to fabricated data — it fails honestly.
    const wantsDemo = body.mode === "demo" || body.useMock === true;
    if (wantsDemo) {
      return NextResponse.json(createMockInvestigation(incident, {}, Boolean(imageDataUrl)));
    }

    if (!process.env.CEREBRAS_API_KEY) {
      return NextResponse.json(
        {
          error: "engine_unconfigured",
          message: "The analysis engine isn’t configured. Set CEREBRAS_API_KEY on the server, or switch to Demo mode to explore sample data.",
        },
        { status: 503 },
      );
    }

    try {
      return NextResponse.json(await runInvestigationPipeline(incident, imageDataUrl, priorIncidents));
    } catch (error) {
      const status = error instanceof CerebrasError ? error.status : undefined;
      const detail = error instanceof Error ? error.message : "Unknown analysis failure";
      const message =
        status === 404
          ? "Gemma 4 isn’t available on this API key yet (model access pending). Switch to Demo mode to explore sample data, or retry once access is granted."
          : status === 401 || status === 403
            ? "The Cerebras API key was rejected. Check CEREBRAS_API_KEY."
            : status === 429
              ? "Rate limited by Cerebras. Wait a moment and try again."
              : "The live analysis didn’t complete. Please try again — or switch to Demo mode to explore sample data.";
      return NextResponse.json({ error: "analysis_failed", message, detail, status }, { status: 502 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown analysis route failure";
    return NextResponse.json({ error: "route_error", message }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { buildRecoveryMessages } from "@/lib/agents";
import { callCerebrasChatCompletion, CerebrasError } from "@/lib/cerebras";
import { recoveryResponseFormat } from "@/lib/schema";

export const runtime = "nodejs";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface ActionOption {
  id: string;
  description: string;
}

function parseActions(value: unknown): ActionOption[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((item) => ({
      id: typeof item.id === "string" ? item.id : "",
      description: typeof item.description === "string" ? item.description : "",
    }))
    .filter((action) => action.id);
}

/**
 * Recovery agent (loop step 5): given an incident and its diagnosis, pick exactly one
 * executable recovery action from the supplied menu. The chosen action is then applied
 * and scored back in the digital twin (closed loop).
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as unknown;
    if (!isRecord(body)) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    const incidentTitle = typeof body.incidentTitle === "string" ? body.incidentTitle : "Industrial cell fault";
    const diagnosis = typeof body.diagnosis === "string" ? body.diagnosis : "";
    const actions = parseActions(body.actions);
    if (actions.length === 0) {
      return NextResponse.json({ error: "No recovery actions supplied" }, { status: 400 });
    }
    const actionIds = new Set(actions.map((action) => action.id));

    // Demo mode: deterministic, safety-first keyword heuristic so the loop runs without a
    // live key. Maps the symptom/diagnosis text onto the corrective action.
    const wantsDemo = body.mode === "demo" || body.useMock === true;
    if (wantsDemo) {
      const text = `${incidentTitle} ${diagnosis}`.toLowerCase();
      const wants = (id: string) => actions.find((a) => a.id === id);
      const pick =
        (/(safety|keep-?out|breach|operator zone|collision|human)/.test(text) && wants("halt_replan_clearance")) ||
        (/(conveyor|belt|jam|indexing|current|stall)/.test(text) && wants("stop_belt_clear_resume")) ||
        (/(quality|defect|classif|confidence|inspect|accept)/.test(text) && wants("quarantine_part")) ||
        (/(short|missing|floor|drop|slip|grasp|grip)/.test(text) && wants("stop_and_regrasp")) ||
        actions.find((a) => a.id !== "continue") ||
        actions[0];
      return NextResponse.json({
        mode: "demo",
        actionId: pick.id,
        rationale: "Demo heuristic: matched the symptom to the corrective action that fails safe.",
        expectedOutcome: "The fault condition clears and the cell returns to a safe nominal state.",
        safetyConsiderations: "Avoids continuing motion toward a hazard or keeping a straining drive energised.",
      });
    }

    if (!process.env.CEREBRAS_API_KEY) {
      return NextResponse.json(
        { error: "engine_unconfigured", message: "Set CEREBRAS_API_KEY, or call with mode 'demo'." },
        { status: 503 },
      );
    }

    try {
      const response = await callCerebrasChatCompletion({
        messages: buildRecoveryMessages(incidentTitle, diagnosis, actions),
        responseFormat: recoveryResponseFormat,
        temperature: 0.2,
        maxTokens: 700,
      });
      const parsed = response.parsedJson;
      if (!isRecord(parsed) || typeof parsed.actionId !== "string" || !actionIds.has(parsed.actionId)) {
        return NextResponse.json(
          { error: "invalid_action", message: "Recovery agent did not return a valid action id from the menu." },
          { status: 502 },
        );
      }
      return NextResponse.json({
        mode: "live",
        actionId: parsed.actionId,
        rationale: typeof parsed.rationale === "string" ? parsed.rationale : "",
        expectedOutcome: typeof parsed.expectedOutcome === "string" ? parsed.expectedOutcome : "",
        safetyConsiderations: typeof parsed.safetyConsiderations === "string" ? parsed.safetyConsiderations : "",
      });
    } catch (error) {
      const status = error instanceof CerebrasError ? error.status : undefined;
      const message = error instanceof Error ? error.message : "Recovery selection failed";
      return NextResponse.json({ error: "recovery_failed", message, status }, { status: 502 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown recover route failure";
    return NextResponse.json({ error: "route_error", message }, { status: 500 });
  }
}

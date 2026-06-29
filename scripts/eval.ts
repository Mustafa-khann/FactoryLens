/**
 * FactoryLens accuracy eval.
 *
 * Runs the live multi-agent pipeline over the labeled demo incidents and scores the
 * commander's most-likely root cause against the known ground truth using Gemma 4 as a judge.
 *
 *   npm run eval
 *
 * Requires CEREBRAS_API_KEY (and Gemma 4 access) in .env.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { callCerebrasChatCompletion } from "../lib/cerebras";
import { runInvestigationPipeline } from "../lib/orchestrator";
import { demoIncidents } from "../lib/simulatedIncidents";

// Minimal .env loader so the script runs outside the Next.js runtime.
function loadEnv() {
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env"), "utf8");
    for (const line of raw.split("\n")) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
    }
  } catch {
    // no .env — rely on the ambient environment
  }
}

const judgeFormat = {
  type: "json_schema",
  json_schema: {
    name: "factorylens_judge",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["match", "reason"],
      properties: {
        match: { type: "boolean" },
        reason: { type: "string" },
      },
    },
  },
} as const;

async function judge(predicted: string, groundTruth: string): Promise<boolean> {
  const response = await callCerebrasChatCompletion({
    messages: [
      { role: "system", content: "You judge whether a predicted root cause matches a known ground truth. Be strict but allow paraphrase. Return JSON only." },
      {
        role: "user",
        content: [`Ground truth: ${groundTruth}`, `Predicted: ${predicted}`, "", "Do they identify the same underlying root cause? Return {match, reason}."].join("\n"),
      },
    ],
    responseFormat: judgeFormat,
    temperature: 0,
    maxTokens: 200,
  });
  const parsed = response.parsedJson as { match?: boolean } | undefined;
  return Boolean(parsed?.match);
}

async function main() {
  loadEnv();
  if (!process.env.CEREBRAS_API_KEY) {
    console.error("CEREBRAS_API_KEY is not set. Add it to .env to run the eval.");
    process.exit(1);
  }

  let correct = 0;
  const rows: { title: string; ok: boolean; predicted: string }[] = [];

  for (const incident of demoIncidents) {
    const analysis = await runInvestigationPipeline(incident);
    const predicted = analysis.result.finalReport.mostLikelyRootCause;
    const ok = await judge(predicted, incident.expectedRootCause ?? incident.hiddenGroundTruth ?? "");
    if (ok) correct += 1;
    rows.push({ title: incident.incidentTitle, ok, predicted });
    console.log(`${ok ? "✓" : "✗"}  ${incident.incidentTitle}\n     → ${predicted}`);
  }

  const pct = Math.round((correct / demoIncidents.length) * 100);
  console.log(`\nTop-1 root-cause accuracy: ${correct}/${demoIncidents.length} (${pct}%)`);
}

void main();

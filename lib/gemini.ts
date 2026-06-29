import { DEFAULT_GEMINI_MODEL, type AnalysisUsage, type ReasoningEffort, type SpeedMetrics } from "./types";
import type { ChatMessage } from "./cerebras";

/** Error thrown when Gemini returns a non-2xx response. */
export class GeminiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "GeminiError";
    this.status = status;
  }
}

interface GeminiChoice {
  message?: {
    content?: string;
  };
  text?: string;
}

interface GeminiApiResponse {
  choices?: GeminiChoice[];
  usage?: AnalysisUsage;
  error?: {
    message?: string;
    type?: string;
    status?: string;
  };
}

interface CallGeminiOptions {
  messages: ChatMessage[];
  responseFormat?: unknown;
  temperature?: number;
  maxTokens?: number;
  reasoningEffort?: ReasoningEffort;
}

export interface GeminiCompletionResult {
  outputText: string;
  parsedJson?: unknown;
  usage?: AnalysisUsage;
  speed: SpeedMetrics;
  raw: unknown;
}

function parseJsonIfPossible(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}

export async function callGeminiChatCompletion({
  messages,
  responseFormat,
  temperature = 0.2,
  maxTokens = 5000,
  reasoningEffort,
}: CallGeminiOptions): Promise<GeminiCompletionResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is missing. Set it on the server to run the Gemini comparison.");
  }

  const model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const effort = reasoningEffort ?? (process.env.GEMINI_REASONING_EFFORT as ReasoningEffort | undefined);
  const baseUrl = process.env.GEMINI_OPENAI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

  const startedAt = performance.now();
  const response = await fetch(baseUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
      ...(effort && effort !== "none" ? { reasoning_effort: effort } : {}),
      ...(responseFormat ? { response_format: responseFormat } : {}),
    }),
  });
  const localLatencyMs = performance.now() - startedAt;

  const bodyText = await response.text();
  let data: GeminiApiResponse | null = null;
  try {
    data = bodyText ? (JSON.parse(bodyText) as GeminiApiResponse) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    const message = data?.error?.message || bodyText || response.statusText;
    throw new GeminiError(`Gemini API request failed (${response.status}): ${message}`, response.status);
  }

  const outputText = data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text;
  if (!outputText) {
    throw new Error("Gemini API response did not include message content.");
  }

  const completionTokens = data?.usage?.completion_tokens;
  const outputTokensPerSecond =
    typeof completionTokens === "number" && localLatencyMs > 0 ? completionTokens / (localLatencyMs / 1000) : undefined;

  return {
    outputText,
    parsedJson: parseJsonIfPossible(outputText),
    usage: data?.usage,
    speed: {
      localLatencyMs,
      outputTokensPerSecond,
    },
    raw: data ?? bodyText,
  };
}

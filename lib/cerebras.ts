import { DEFAULT_CEREBRAS_MODEL, type AnalysisUsage, type ReasoningEffort, type SpeedMetrics } from "./types";

/** Error thrown when Cerebras returns a non-2xx response. Carries the HTTP status so callers can react (e.g. 404 = model access pending). */
export class CerebrasError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "CerebrasError";
    this.status = status;
  }
}

export type ChatMessageContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | {
          type: "image_url";
          image_url: {
            url: string;
          };
        }
    >;

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: ChatMessageContent;
}

interface CerebrasChoice {
  message?: {
    content?: string;
  };
  text?: string;
}

interface CerebrasApiResponse {
  choices?: CerebrasChoice[];
  usage?: AnalysisUsage;
  time_info?: unknown;
  timeInfo?: unknown;
  error?: {
    message?: string;
    type?: string;
  };
}

interface CallCerebrasOptions {
  messages: ChatMessage[];
  responseFormat?: unknown;
  temperature?: number;
  maxTokens?: number;
  reasoningEffort?: ReasoningEffort;
}

export interface CerebrasCompletionResult {
  outputText: string;
  parsedJson?: unknown;
  usage?: AnalysisUsage;
  timeInfo?: unknown;
  speed: SpeedMetrics;
  raw: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function numberFromTimeInfo(timeInfo: unknown, keys: string[]) {
  const record = asRecord(timeInfo);
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
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

export async function callCerebrasChatCompletion({
  messages,
  responseFormat,
  temperature = 0.2,
  maxTokens = 5000,
  reasoningEffort,
}: CallCerebrasOptions): Promise<CerebrasCompletionResult> {
  const apiKey = process.env.CEREBRAS_API_KEY;
  if (!apiKey) {
    throw new Error("CEREBRAS_API_KEY is missing. Set it on the server to run live Cerebras inference.");
  }

  const model = process.env.CEREBRAS_MODEL || DEFAULT_CEREBRAS_MODEL;
  // reasoning_effort is model-specific: some models reject "none", others reject it entirely.
  // Default to omitting it unless explicitly passed or set via CEREBRAS_REASONING_EFFORT.
  const effort = reasoningEffort ?? (process.env.CEREBRAS_REASONING_EFFORT as ReasoningEffort | undefined);
  const startedAt = performance.now();
  const response = await fetch("https://api.cerebras.ai/v1/chat/completions", {
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
  let data: CerebrasApiResponse | null = null;
  try {
    data = bodyText ? (JSON.parse(bodyText) as CerebrasApiResponse) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    const message = data?.error?.message || bodyText || response.statusText;
    throw new CerebrasError(`Cerebras API request failed (${response.status}): ${message}`, response.status);
  }

  const outputText = data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text;
  if (!outputText) {
    throw new Error("Cerebras API response did not include message content.");
  }

  const timeInfo = data?.time_info ?? data?.timeInfo;
  const completionTokens = data?.usage?.completion_tokens;
  const outputTokensPerSecond =
    typeof completionTokens === "number" && localLatencyMs > 0 ? completionTokens / (localLatencyMs / 1000) : undefined;
  const timeToFirstTokenMs = numberFromTimeInfo(timeInfo, [
    "time_to_first_token_ms",
    "timeToFirstTokenMs",
    "ttft_ms",
    "first_token_ms",
  ]);

  return {
    outputText,
    parsedJson: parseJsonIfPossible(outputText),
    usage: data?.usage,
    timeInfo,
    speed: {
      localLatencyMs,
      outputTokensPerSecond,
      timeToFirstTokenMs,
    },
    raw: data ?? bodyText,
  };
}

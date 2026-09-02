import type { AiProviderKind } from "@/lib/types";

export interface AiChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AiChatParams {
  temperature: number;
  maxOutputTokens: number;
  contextTokens: number;
}

/** How the JSON constraint was expressed on a given attempt. */
export type StructuredAttempt = "schema" | "json_object" | "none";

export const STRUCTURED_ATTEMPT_ORDER: StructuredAttempt[] = ["schema", "json_object", "none"];

/**
 * Trailing API paths people commonly paste when they copy the URL a doc or
 * curl example shows them, rather than the bare base URL this app expects.
 * Only the endpoint-specific tail is listed — never a leading "/v1" — so a
 * pasted ".../v1/models" strips down to ".../v1" rather than losing the /v1
 * namespace marker entirely. Keeping /v1 when present means
 * guessProviderKind() can identify the server as OpenAI-compatible straight
 * away instead of needing to probe both kinds.
 */
const KNOWN_API_PATH_SUFFIXES = [
  "/chat/completions",
  "/models",
  "/api/tags",
  "/api/chat",
  "/api/generate"
];

function stripKnownApiPath(baseUrl: string): string {
  const lowered = baseUrl.toLowerCase();
  const suffix = KNOWN_API_PATH_SUFFIXES.find((candidate) => lowered.endsWith(candidate));
  return suffix ? baseUrl.slice(0, baseUrl.length - suffix.length) : baseUrl;
}

export function normalizeBaseUrl(rawBaseUrl: string): string {
  const trimmed = rawBaseUrl.trim().replace(/\/+$/, "");
  const withoutApiPath = stripKnownApiPath(trimmed).replace(/\/+$/, "");
  return withoutApiPath;
}

/**
 * A base URL ending in /v1 is unambiguously OpenAI-compatible (LM Studio,
 * llama.cpp, vLLM). Anything else is probed, Ollama first.
 */
export function guessProviderKind(baseUrl: string): AiProviderKind | null {
  const normalized = normalizeBaseUrl(baseUrl).toLowerCase();
  if (normalized.endsWith("/v1")) {
    return "openai-compatible";
  }
  return null;
}

export function modelsUrl(baseUrl: string, kind: AiProviderKind): string {
  const base = normalizeBaseUrl(baseUrl);
  return kind === "ollama" ? `${base}/api/tags` : `${base}/models`;
}

export function chatUrl(baseUrl: string, kind: AiProviderKind): string {
  const base = normalizeBaseUrl(baseUrl);
  return kind === "ollama" ? `${base}/api/chat` : `${base}/chat/completions`;
}

/**
 * OpenAI-compatible servers are usually addressed at `.../v1`. Accept a base
 * URL with or without it so the user can paste either form.
 */
export function withOpenAiSuffix(baseUrl: string): string {
  const base = normalizeBaseUrl(baseUrl);
  return base.toLowerCase().endsWith("/v1") ? base : `${base}/v1`;
}

/**
 * Parses a model-listing response, returning null when the payload is not
 * actually this provider's shape.
 *
 * The distinction matters: LM Studio answers unknown endpoints with HTTP 200
 * and a body like {"error":"Unexpected endpoint or method. (GET /api/tags)"}.
 * A status check alone therefore accepts it, and returning [] for that made an
 * empty list indistinguishable from a genuine Ollama server with no models
 * pulled -- so probing stopped on the wrong provider and reported success with
 * zero models. null means "not this provider, keep looking".
 */
export function parseModelList(kind: AiProviderKind, payload: unknown): string[] | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  if (typeof (payload as { error?: unknown }).error === "string") {
    return null;
  }

  const container = kind === "ollama" ? (payload as { models?: unknown }).models : (payload as { data?: unknown }).data;
  if (!Array.isArray(container)) {
    return null;
  }

  const key = kind === "ollama" ? "name" : "id";
  return container
    .map((entry) =>
      entry && typeof entry === "object" ? (entry as Record<string, unknown>)[key] : null
    )
    .filter((value): value is string => typeof value === "string" && value.length > 0);
}

/**
 * Which provider to probe first for a given base URL. Only an ordering hint --
 * both are still tried -- but it avoids a pointless round trip in the common
 * cases and reduces the chance of a odd response from the wrong endpoint being
 * mistaken for a match.
 */
export function probeOrder(baseUrl: string): AiProviderKind[] {
  const hinted = guessProviderKind(baseUrl);
  if (hinted) {
    return [hinted];
  }

  let port = "";
  try {
    port = new URL(normalizeBaseUrl(baseUrl)).port;
  } catch {
    port = "";
  }

  // 11434 is Ollama's default; 1234 (LM Studio) and 8080 (llama.cpp) are
  // OpenAI-compatible.
  if (port === "1234" || port === "8080" || port === "8000") {
    return ["openai-compatible", "ollama"];
  }

  return ["ollama", "openai-compatible"];
}

export function buildChatBody(input: {
  kind: AiProviderKind;
  model: string;
  messages: AiChatMessage[];
  params: AiChatParams;
  jsonSchema: Record<string, unknown> | null;
  attempt: StructuredAttempt;
  stream?: boolean;
  disableReasoning?: boolean;
}): Record<string, unknown> {
  const { kind, model, messages, params, jsonSchema, attempt } = input;
  const stream = input.stream ?? false;
  const disableReasoning = input.disableReasoning ?? false;

  if (kind === "ollama") {
    const body: Record<string, unknown> = {
      model,
      messages,
      stream,
      options: {
        temperature: params.temperature,
        num_ctx: params.contextTokens,
        num_predict: params.maxOutputTokens
      }
    };

    if (attempt === "schema" && jsonSchema) {
      body.format = jsonSchema;
    } else if (attempt === "json_object") {
      body.format = "json";
    }

    // Ollama exposes thinking as a top-level boolean on thinking-capable models.
    if (disableReasoning) {
      body.think = false;
    }

    return body;
  }

  const body: Record<string, unknown> = {
    model,
    messages,
    stream,
    temperature: params.temperature,
    max_tokens: params.maxOutputTokens
  };

  if (attempt === "schema" && jsonSchema) {
    body.response_format = {
      type: "json_schema",
      json_schema: { name: "quiz_payload", strict: true, schema: jsonSchema }
    };
  } else if (attempt === "json_object") {
    body.response_format = { type: "json_object" };
  }

  // Measured against LM Studio: "none" is the only switch that actually takes
  // effect. chat_template_kwargs.enable_thinking and a /no_think suffix were
  // both ignored, and "low" was worse than useless -- it spent the entire
  // token budget thinking and returned an empty answer.
  if (disableReasoning) {
    body.reasoning_effort = "none";
  }

  return body;
}

export function extractChatText(kind: AiProviderKind, payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  if (kind === "ollama") {
    const message = (payload as { message?: { content?: unknown } }).message;
    return typeof message?.content === "string" ? message.content : "";
  }

  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return "";
  }
  const content = (choices[0] as { message?: { content?: unknown } })?.message?.content;
  return typeof content === "string" ? content : "";
}

/**
 * True when a server rejected the request specifically because of the JSON
 * constraint, which means the next weaker attempt is worth trying.
 */
/** True when a server rejected the request because of the reasoning parameter. */
export function isReasoningRejection(status: number, bodyText: string): boolean {
  if (status < 400 || status >= 500) {
    return false;
  }
  const lowered = bodyText.toLowerCase();
  return lowered.includes("reasoning_effort") || lowered.includes("reasoning") || lowered.includes("think");
}

export function isStructuredOutputRejection(status: number, bodyText: string): boolean {
  if (status < 400 || status >= 500) {
    return false;
  }
  const lowered = bodyText.toLowerCase();
  return (
    lowered.includes("response_format") ||
    lowered.includes("json_schema") ||
    lowered.includes("json schema") ||
    lowered.includes("grammar") ||
    (lowered.includes("format") && lowered.includes("support"))
  );
}


/* ------------------------------------------------------------------ *
 * Streaming
 * ------------------------------------------------------------------ */

/** One piece of streamed output. Reasoning is tracked apart from the answer. */
export interface StreamDelta {
  kind: "content" | "reasoning";
  text: string;
}

/**
 * Incrementally turns raw response bytes into deltas.
 *
 * Ollama streams newline-delimited JSON objects; OpenAI-compatible servers
 * stream SSE `data:` lines. Both arrive split across arbitrary chunk
 * boundaries, so the decoder buffers a partial trailing line between pushes.
 *
 * Reasoning models (Qwen3, DeepSeek-R1 and friends, which are the norm in LM
 * Studio) emit their chain of thought in a separate field -- `reasoning_content`
 * on OpenAI-compatible servers, `thinking` on Ollama -- and only later emit the
 * actual answer. Reading just the answer field makes such a model look frozen
 * for minutes and then return nothing, so both are captured and kept distinct:
 * reasoning drives progress display, content is what gets parsed.
 */
export function createStreamDecoder(kind: AiProviderKind) {
  let buffer = "";
  let finished = false;

  function parseLine(line: string): StreamDelta[] {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      return [];
    }

    let raw = trimmed;
    if (kind !== "ollama") {
      if (!trimmed.startsWith("data:")) {
        return [];
      }
      raw = trimmed.slice(5).trim();
      if (raw === "[DONE]") {
        finished = true;
        return [];
      }
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return [];
    }

    const error = payload.error;
    if (error) {
      const message =
        typeof error === "string" ? error : (error as { message?: string })?.message ?? "Model server reported an error.";
      throw new Error(message);
    }

    const deltas: StreamDelta[] = [];
    const push = (value: unknown, deltaKind: StreamDelta["kind"]) => {
      if (typeof value === "string" && value.length > 0) {
        deltas.push({ kind: deltaKind, text: value });
      }
    };

    if (kind === "ollama") {
      if (payload.done === true) {
        finished = true;
      }
      const message = payload.message as { content?: unknown; thinking?: unknown } | undefined;
      push(message?.thinking, "reasoning");
      push(message?.content, "content");
      return deltas;
    }

    const choice = (payload.choices as { delta?: Record<string, unknown>; text?: unknown }[] | undefined)?.[0];
    if (!choice) {
      return deltas;
    }

    const delta = choice.delta ?? {};
    push(delta.reasoning_content ?? delta.reasoning, "reasoning");
    push(delta.content, "content");
    // Some completion-style servers use `text` rather than `delta.content`.
    if (deltas.length === 0) {
      push(choice.text, "content");
    }
    return deltas;
  }

  return {
    push(chunk: string): StreamDelta[] {
      buffer += chunk;
      const lines = buffer.split("\n");
      // The last element is an incomplete line unless the chunk ended on \n.
      buffer = lines.pop() ?? "";

      const deltas: StreamDelta[] = [];
      for (const line of lines) {
        deltas.push(...parseLine(line));
      }
      return deltas;
    },
    /** Drains any trailing line left without a newline terminator. */
    flush(): StreamDelta[] {
      if (buffer.trim().length === 0) {
        buffer = "";
        return [];
      }
      const deltas = parseLine(buffer);
      buffer = "";
      return deltas;
    },
    get done(): boolean {
      return finished;
    }
  };
}

/* ------------------------------------------------------------------ *
 * Token budgeting
 * ------------------------------------------------------------------ */

const CONTEXT_LADDER = [2048, 4096, 8192, 16384, 32768, 65536, 131072];

/**
 * Rough token cost of one generated MCQ, including JSON punctuation.
 * Deliberately generous: running out of output tokens truncates the JSON and
 * wastes the whole batch, which costs far more than a slightly high cap.
 */
export function estimateQuestionTokens(optionCount: number): number {
  return 150 + optionCount * 28;
}

/** Rough token cost of one enrichment review, which is much longer. */
export function estimateReviewTokens(optionCount: number): number {
  return 320 + optionCount * 70;
}

/**
 * Caps generation to what the batch actually needs.
 *
 * A flat 8192 lets a model that falls into a repetition loop burn the entire
 * budget on a three-question batch before anyone notices.
 */
export const DEFAULT_REASONING_ALLOWANCE = 3072;

export function sizeOutputTokens(
  estimatedNeed: number,
  ceiling: number,
  reasoningAllowance = DEFAULT_REASONING_ALLOWANCE
): number {
  const withHeadroom = Math.ceil(estimatedNeed * 1.25) + 256 + Math.max(0, reasoningAllowance);
  return Math.max(512, Math.min(ceiling, withHeadroom));
}

/**
 * Picks the smallest context window that still fits prompt plus output.
 *
 * Local backends allocate a KV cache sized to num_ctx, so asking for 16k when
 * the job needs 4k is a direct, avoidable slowdown. Never exceeds the ceiling
 * the user configured, so this can only narrow the window, never widen it.
 */
export function sizeContextTokens(promptChars: number, outputTokens: number, ceiling: number): number {
  // chars/3.2 rather than the usual /4: overestimating the prompt is safe,
  // underestimating silently truncates it.
  const promptTokens = Math.ceil(promptChars / 3.2);
  const need = Math.ceil((promptTokens + outputTokens) * 1.15);
  const rung = CONTEXT_LADDER.find((size) => size >= need) ?? CONTEXT_LADDER[CONTEXT_LADDER.length - 1];
  return Math.max(2048, Math.min(ceiling, rung));
}

export function messagesCharLength(messages: AiChatMessage[]): number {
  return messages.reduce((sum, message) => sum + message.content.length, 0);
}

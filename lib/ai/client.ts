import type { AiConnectionSettings, AiProviderKind } from "@/lib/types";
import type { AiChatMessage } from "@/lib/ai/provider";

export interface ModelListResult {
  kind: AiProviderKind;
  baseUrl: string;
  models: string[];
}

/**
 * A fetch to our own /api route throwing means the app's server is gone --
 * a completely different problem from the model server being unreachable.
 * Reporting the raw "Failed to fetch" made the two indistinguishable.
 */
function appServerError(error: unknown): Error {
  const origin = typeof window === "undefined" ? "the app server" : window.location.origin;
  if (error instanceof TypeError) {
    return new Error(
      `Could not reach the quiz tool's own server at ${origin}. This is not your model server -- the app itself is unreachable. Check that "npm run dev" is still running, and that this page is open on the port it is serving.`
    );
  }
  return error instanceof Error ? error : new Error(String(error));
}

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: unknown };
    if (typeof payload.error === "string" && payload.error.length > 0) {
      return payload.error;
    }
  } catch {
    // fall through
  }
  return fallback;
}

export async function fetchModelList(baseUrl: string, signal?: AbortSignal): Promise<ModelListResult> {
  let response: Response;
  try {
    response = await fetch(`/api/ai/models?baseUrl=${encodeURIComponent(baseUrl)}`, {
      method: "GET",
      signal
    });
  } catch (error) {
    throw appServerError(error);
  }

  if (!response.ok) {
    throw new Error(await readError(response, `Model discovery failed (${response.status}).`));
  }

  return (await response.json()) as ModelListResult;
}

export interface CompletionRequest {
  connection: AiConnectionSettings;
  kind: AiProviderKind;
  messages: AiChatMessage[];
  jsonSchema?: Record<string, unknown> | null;
  signal?: AbortSignal;
  /** Expected output size for this specific call, so the server can size the run. */
  outputTokenHint?: number;
  /** Fires as output arrives, for live progress. */
  onDelta?: (progress: { chars: number; reasoningChars: number; thinking: boolean }) => void;
}

interface SseEvent {
  type?: unknown;
  text?: unknown;
  error?: unknown;
  chars?: unknown;
}

/**
 * Streams a completion through our own proxy route.
 *
 * Streaming is not just cosmetic here: it gives the user visible progress on a
 * run that can take minutes, and it means aborting actually severs the upstream
 * connection mid-generation instead of waiting for a response nobody wants.
 */
export async function requestCompletion(input: CompletionRequest): Promise<string> {
  const { connection, kind, messages, jsonSchema, signal, outputTokenHint, onDelta } = input;

  let response: Response;
  try {
    response = await fetch("/api/ai/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal,
    body: JSON.stringify({
      baseUrl: connection.baseUrl,
      kind,
      model: connection.model,
      apiKey: connection.apiKey,
      messages,
      jsonSchema: jsonSchema ?? null,
      structuredOutput: connection.structuredOutput,
      reasoning: connection.reasoning,
      temperature: connection.temperature,
      maxOutputTokens: connection.maxOutputTokens,
      contextTokens: connection.contextTokens,
      timeoutMs: connection.requestTimeoutMs,
      outputTokenHint: outputTokenHint ?? connection.maxOutputTokens,
      stream: true
    })
    });
  } catch (error) {
    // A deliberate Stop is an abort, not a server outage.
    if (signal?.aborted) {
      throw error;
    }
    throw appServerError(error);
  }

  if (!response.ok) {
    throw new Error(await readError(response, `Generation failed (${response.status}).`));
  }

  if (!response.body) {
    throw new Error("The model returned an empty response.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let accumulated = "";
  let reasoningChars = 0;
  let finalText: string | null = null;
  let streamError: string | null = null;

  const handleEvent = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed.startsWith("data:")) {
      return;
    }

    let event: SseEvent;
    try {
      event = JSON.parse(trimmed.slice(5).trim()) as SseEvent;
    } catch {
      return;
    }

    if (event.type === "reasoning" && typeof event.chars === "number") {
      reasoningChars = event.chars;
      onDelta?.({ chars: accumulated.length, reasoningChars, thinking: true });
      return;
    }
    if (event.type === "delta" && typeof event.text === "string") {
      accumulated += event.text;
      onDelta?.({ chars: accumulated.length, reasoningChars, thinking: false });
      return;
    }
    if (event.type === "done" && typeof event.text === "string") {
      finalText = event.text;
      return;
    }
    if (event.type === "error" && typeof event.error === "string") {
      streamError = event.error;
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";
      for (const event of events) {
        handleEvent(event);
      }
    }

    if (buffer.trim().length > 0) {
      handleEvent(buffer);
    }
  } finally {
    reader.releaseLock();
  }

  if (streamError) {
    throw new Error(streamError);
  }

  const text = finalText ?? accumulated;
  if (text.trim().length === 0) {
    throw new Error("The model returned an empty response.");
  }

  return text;
}

import { NextResponse } from "next/server";
import { isAllowedAiHost } from "@/lib/ai/allowlist";
import {
  buildChatBody,
  chatUrl,
  createStreamDecoder,
  extractChatText,
  isReasoningRejection,
  isStructuredOutputRejection,
  messagesCharLength,
  normalizeBaseUrl,
  sizeContextTokens,
  sizeOutputTokens,
  STRUCTURED_ATTEMPT_ORDER,
  withOpenAiSuffix,
  type AiChatMessage,
  type StructuredAttempt
} from "@/lib/ai/provider";
import type { AiProviderKind } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 4 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 180_000;
const MAX_TIMEOUT_MS = 900_000;

interface GenerateRequestBody {
  baseUrl?: unknown;
  kind?: unknown;
  model?: unknown;
  apiKey?: unknown;
  messages?: unknown;
  jsonSchema?: unknown;
  structuredOutput?: unknown;
  temperature?: unknown;
  maxOutputTokens?: unknown;
  contextTokens?: unknown;
  timeoutMs?: unknown;
  reasoning?: unknown;
  outputTokenHint?: unknown;
  stream?: unknown;
}

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

function isMessageArray(value: unknown): value is AiChatMessage[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        typeof (entry as AiChatMessage).content === "string" &&
        ["system", "user", "assistant"].includes((entry as AiChatMessage).role)
    )
  );
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

function attemptsFor(structuredOutput: unknown, hasSchema: boolean): StructuredAttempt[] {
  if (structuredOutput === "off") {
    return ["none"];
  }
  if (!hasSchema) {
    return ["json_object", "none"];
  }
  if (structuredOutput === "on") {
    return ["schema"];
  }
  return STRUCTURED_ATTEMPT_ORDER;
}

function sseLine(payload: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`);
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_BYTES) {
    return badRequest("Request body is too large.");
  }

  let body: GenerateRequestBody;
  try {
    body = JSON.parse(rawBody) as GenerateRequestBody;
  } catch {
    return badRequest("Request body is not valid JSON.");
  }

  const baseUrl = normalizeBaseUrl(typeof body.baseUrl === "string" ? body.baseUrl : "");
  if (!baseUrl) {
    return badRequest("baseUrl is required.");
  }

  const guard = isAllowedAiHost(baseUrl);
  if (!guard.allowed) {
    return NextResponse.json({ error: guard.reason }, { status: 400 });
  }

  const kind: AiProviderKind = body.kind === "openai-compatible" ? "openai-compatible" : "ollama";
  const model = typeof body.model === "string" ? body.model.trim() : "";
  if (!model) {
    return badRequest("model is required.");
  }

  if (!isMessageArray(body.messages)) {
    return badRequest("messages must be a non-empty array of {role, content}.");
  }

  const messages = body.messages;
  const jsonSchema =
    body.jsonSchema && typeof body.jsonSchema === "object"
      ? (body.jsonSchema as Record<string, unknown>)
      : null;

  const maxOutputTokens = clampNumber(body.maxOutputTokens, 4096, 256, 131_072);
  const contextCeiling = clampNumber(body.contextTokens, 16_384, 1024, 1_048_576);

  // Size the generation to what this specific batch needs rather than handing
  // every request the same flat ceiling. Both only ever narrow the request.
  const outputTokens = sizeOutputTokens(
    clampNumber(body.outputTokenHint, maxOutputTokens, 128, 131_072),
    maxOutputTokens
  );
  const promptChars = messagesCharLength(messages);
  const contextTokens = sizeContextTokens(promptChars, outputTokens, contextCeiling);

  const params = {
    temperature: clampNumber(body.temperature, 0.2, 0, 2),
    maxOutputTokens: outputTokens,
    contextTokens
  };
  const timeoutMs = clampNumber(body.timeoutMs, DEFAULT_TIMEOUT_MS, 5_000, MAX_TIMEOUT_MS);
  const wantsStream = body.stream !== false;

  const endpoint = chatUrl(kind === "openai-compatible" ? withOpenAiSuffix(baseUrl) : baseUrl, kind);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: wantsStream ? "text/event-stream" : "application/json"
  };
  if (typeof body.apiKey === "string" && body.apiKey.trim().length > 0) {
    headers.authorization = `Bearer ${body.apiKey.trim()}`;
  }

  /*
   * The upstream call must die when the browser goes away.
   *
   * Previously this was only wired to the timeout, so pressing Stop aborted
   * the browser's fetch while the model server happily kept generating to
   * completion. Chaining the incoming request's signal means a client
   * disconnect tears down the upstream socket, which is what actually makes
   * Ollama / llama.cpp cancel the run.
   */
  const upstreamAbort = new AbortController();
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const abortUpstream = () => upstreamAbort.abort();
  request.signal.addEventListener("abort", abortUpstream, { once: true });
  timeoutSignal.addEventListener("abort", abortUpstream, { once: true });
  if (request.signal.aborted) {
    upstreamAbort.abort();
  }

  const attempts = attemptsFor(body.structuredOutput, Boolean(jsonSchema));
  let lastError = "The model server did not return a usable response.";
  // Only some servers understand a reasoning switch; drop it if one objects.
  let disableReasoning = body.reasoning !== "on";
  let reasoningRetries = 0;

  for (let index = 0; index < attempts.length; index += 1) {
    const attempt = attempts[index];
    const isLastAttempt = index === attempts.length - 1;

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(
          buildChatBody({
            kind,
            model,
            messages,
            params,
            jsonSchema,
            attempt,
            stream: wantsStream,
            disableReasoning
          })
        ),
        signal: upstreamAbort.signal,
        cache: "no-store"
      });
    } catch (error) {
      request.signal.removeEventListener("abort", abortUpstream);
      if (request.signal.aborted) {
        // The client hung up. Nothing to report back to.
        return new Response(null, { status: 499 });
      }
      const message = error instanceof Error ? error.message : "Request failed";
      const timedOut = timeoutSignal.aborted;
      return NextResponse.json(
        {
          error: timedOut
            ? `The model server did not respond within ${Math.round(timeoutMs / 1000)}s. Try a smaller batch or a faster model.`
            : `Could not reach ${endpoint}: ${message}`
        },
        { status: 504 }
      );
    }

    if (!response.ok) {
      const errorText = (await response.text()).slice(0, 2000);
      lastError = `Model server returned ${response.status}: ${errorText || response.statusText}`;

      // A server that does not understand the reasoning switch should not lose
      // the whole request over it: drop the parameter and try this attempt again.
      if (disableReasoning && reasoningRetries === 0 && isReasoningRejection(response.status, errorText)) {
        disableReasoning = false;
        reasoningRetries += 1;
        index -= 1;
        continue;
      }

      // Only a structured-output rejection is worth retrying with a weaker
      // constraint; anything else is a real failure.
      if (isStructuredOutputRejection(response.status, errorText) && !isLastAttempt) {
        continue;
      }
      request.signal.removeEventListener("abort", abortUpstream);
      return NextResponse.json({ error: lastError }, { status: 502 });
    }

    const meta = {
      structuredAttempt: attempt,
      reasoningDisabled: disableReasoning,
      contextTokens,
      outputTokens,
      promptChars
    };

    if (!wantsStream) {
      request.signal.removeEventListener("abort", abortUpstream);
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        return NextResponse.json({ error: "Model server returned a non-JSON response." }, { status: 502 });
      }
      const text = extractChatText(kind, payload);
      if (!text.trim()) {
        return NextResponse.json({ error: "Model server returned an empty completion." }, { status: 502 });
      }
      return NextResponse.json({ text, ...meta });
    }

    const upstreamBody = response.body;
    if (!upstreamBody) {
      request.signal.removeEventListener("abort", abortUpstream);
      return NextResponse.json({ error: "Model server returned an empty stream." }, { status: 502 });
    }

    const decoder = createStreamDecoder(kind);
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const reader = upstreamBody.getReader();
        const textDecoder = new TextDecoder();
        let full = "";
        let reasoningChars = 0;

        try {
          const emit = (deltas: ReturnType<typeof decoder.push>) => {
            for (const delta of deltas) {
              if (delta.kind === "reasoning") {
                reasoningChars += delta.text.length;
                controller.enqueue(sseLine({ type: "reasoning", chars: reasoningChars }));
                continue;
              }
              full += delta.text;
              controller.enqueue(sseLine({ type: "delta", text: delta.text }));
            }
          };

          for (;;) {
            const { done, value } = await reader.read();
            if (done) {
              break;
            }
            emit(decoder.push(textDecoder.decode(value, { stream: true })));
          }

          emit(decoder.flush());

          if (full.trim().length === 0) {
            controller.enqueue(
              sseLine({
                type: "error",
                error:
                  reasoningChars > 0
                    ? `This model spent its entire ${outputTokens}-token budget reasoning (${reasoningChars.toLocaleString()} characters of thinking) and never produced an answer. Raise Max Output Tokens, or pick a model without extended reasoning.`
                    : "Model server returned an empty completion."
              })
            );
          } else {
            controller.enqueue(sseLine({ type: "done", text: full, reasoningChars, ...meta }));
          }
        } catch (error) {
          // An abort here is the expected path when the user presses Stop.
          if (!upstreamAbort.signal.aborted) {
            const message = error instanceof Error ? error.message : "Stream failed.";
            controller.enqueue(sseLine({ type: "error", error: message }));
          }
        } finally {
          request.signal.removeEventListener("abort", abortUpstream);
          reader.releaseLock();
          try {
            controller.close();
          } catch {
            // Already closed by a client disconnect.
          }
        }
      },
      cancel() {
        // Belt and braces: fires when the response pipe is torn down, which is
        // the most reliable signal that the browser is gone.
        upstreamAbort.abort();
      }
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no"
      }
    });
  }

  request.signal.removeEventListener("abort", abortUpstream);
  return NextResponse.json({ error: lastError }, { status: 502 });
}

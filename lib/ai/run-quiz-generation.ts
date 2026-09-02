import { requestCompletion } from "@/lib/ai/client";
import { estimateQuestionTokens, type AiChatMessage } from "@/lib/ai/provider";
import { parseQuizResponse } from "@/lib/quiz/parse";
import { buildQuizJsonSchema } from "@/lib/quiz/schema";
import type { AiConnectionSettings, AiProviderKind, PromptBatchState } from "@/lib/types";

export const SYSTEM_PROMPT =
  "You are a strict quiz-generation engine. You return only raw JSON that matches the requested schema exactly. Never use Markdown, code fences, or commentary.";

export interface BatchAttemptLog {
  attempt: number;
  errors: string[];
}

export type BatchOutcome =
  | { ok: true; batchIndex: number; rawResponse: string; attempts: number }
  | { ok: false; batchIndex: number; errors: string[]; attempts: number };

export interface RunGenerationOptions {
  connection: AiConnectionSettings;
  kind: AiProviderKind;
  maxRepairAttempts?: number;
  signal?: AbortSignal;
  onAttempt?: (log: BatchAttemptLog & { batchIndex: number }) => void;
  /** Live progress: output received so far on the current attempt. */
  onProgress?: (progress: {
    batchIndex: number;
    attempt: number;
    chars: number;
    reasoningChars: number;
    thinking: boolean;
  }) => void;
}

function buildRepairMessage(previousOutput: string, errors: string[]): string {
  return [
    "Your previous response failed validation.",
    "",
    "VALIDATION ERRORS",
    ...errors.map((error) => `- ${error}`),
    "",
    "PREVIOUS RESPONSE",
    previousOutput.slice(0, 12_000),
    "",
    "Return the corrected JSON only. No Markdown, no code fences, no commentary. Fix every listed error and keep everything that was already valid."
  ].join("\n");
}

/**
 * Runs one batch through the local model, validating with the same parser the
 * manual paste flow uses and feeding validation errors back on failure.
 */
export async function generateBatch(
  batchIndex: number,
  batch: PromptBatchState,
  promptText: string,
  options: RunGenerationOptions
): Promise<BatchOutcome> {
  const { connection, kind, signal, onAttempt, onProgress } = options;
  const maxRepairAttempts = options.maxRepairAttempts ?? 2;
  const jsonSchema =
    batch.responseFormat === "compact" ? null : buildQuizJsonSchema(batch.optionCount);
  // Ask for only as many tokens as this batch can plausibly need.
  const outputTokenHint = batch.questionCount * estimateQuestionTokens(batch.optionCount);

  const messages: AiChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: promptText }
  ];

  let lastErrors: string[] = ["The model did not return a valid quiz payload."];

  for (let attempt = 0; attempt <= maxRepairAttempts; attempt += 1) {
    if (signal?.aborted) {
      return { ok: false, batchIndex, errors: ["Run stopped."], attempts: attempt };
    }

    let text: string;
    try {
      text = await requestCompletion({
        connection,
        kind,
        messages,
        jsonSchema,
        signal,
        outputTokenHint,
        onDelta: (progress) => onProgress?.({ batchIndex, attempt: attempt + 1, ...progress })
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Request failed.";
      if (signal?.aborted) {
        return { ok: false, batchIndex, errors: ["Run stopped."], attempts: attempt + 1 };
      }
      return { ok: false, batchIndex, errors: [message], attempts: attempt + 1 };
    }

    const parsed = parseQuizResponse(text, batch.responseFormat, batch.optionCount);
    if (parsed.success && parsed.data) {
      return { ok: true, batchIndex, rawResponse: text, attempts: attempt + 1 };
    }

    lastErrors = parsed.errors;
    onAttempt?.({ batchIndex, attempt: attempt + 1, errors: parsed.errors });

    if (attempt < maxRepairAttempts) {
      messages.push({ role: "assistant", content: text.slice(0, 12_000) });
      messages.push({ role: "user", content: buildRepairMessage(text, parsed.errors) });
    }
  }

  return { ok: false, batchIndex, errors: lastErrors, attempts: maxRepairAttempts + 1 };
}

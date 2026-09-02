import { requestCompletion } from "@/lib/ai/client";
import { estimateReviewTokens, type AiChatMessage } from "@/lib/ai/provider";
import { buildReviewPrompt, resolveSourceText, type ReviewPromptItem } from "@/lib/prompt/build-review-prompt";
import { parseReviewResponse } from "@/lib/quiz/review-parse";
import { buildReviewJsonSchema } from "@/lib/quiz/schema";
import type {
  AiConnectionSettings,
  AiProviderKind,
  QuizPayload,
  QuizQuestion,
  SourceChunk
} from "@/lib/types";

export const REVIEW_SYSTEM_PROMPT =
  "You write precise, source-grounded study explanations. You return only raw JSON matching the requested schema. Never use Markdown, code fences, or commentary.";

export const DEFAULT_ENRICHMENT_GROUP_SIZE = 4;

export interface EnrichmentGroup {
  /** Indexes into the quiz's questions array. */
  questionIndexes: number[];
  items: ReviewPromptItem[];
  optionCount: number;
}

/** Questions still missing a usable review. */
export function needsReview(question: QuizQuestion): boolean {
  const review = question.review;
  if (!review) {
    return true;
  }
  return review.optionRationales.length !== question.options.length;
}

/**
 * Groups questions for enrichment. Questions are grouped by option count so a
 * single JSON schema constrains the whole call.
 */
export function buildEnrichmentGroups(
  quiz: QuizPayload,
  chunks: SourceChunk[],
  options: { groupSize?: number; onlyMissing?: boolean; indexes?: number[] } = {}
): EnrichmentGroup[] {
  const groupSize = Math.max(1, options.groupSize ?? DEFAULT_ENRICHMENT_GROUP_SIZE);
  const onlyMissing = options.onlyMissing ?? true;

  const candidates = (options.indexes ?? quiz.questions.map((_, index) => index)).filter((index) => {
    const question = quiz.questions[index];
    if (!question) {
      return false;
    }
    return onlyMissing ? needsReview(question) : true;
  });

  const byOptionCount = new Map<number, number[]>();
  for (const index of candidates) {
    const optionCount = quiz.questions[index].options.length;
    const bucket = byOptionCount.get(optionCount) ?? [];
    bucket.push(index);
    byOptionCount.set(optionCount, bucket);
  }

  const groups: EnrichmentGroup[] = [];
  for (const [optionCount, indexes] of byOptionCount.entries()) {
    for (let start = 0; start < indexes.length; start += groupSize) {
      const questionIndexes = indexes.slice(start, start + groupSize);
      groups.push({
        optionCount,
        questionIndexes,
        items: questionIndexes.map((index, position) => ({
          questionNumber: position + 1,
          question: quiz.questions[index],
          sourceText: resolveSourceText(quiz.questions[index], chunks)
        }))
      });
    }
  }

  return groups;
}

export type EnrichmentOutcome =
  | { ok: true; questionIndexes: number[]; questions: QuizQuestion[] }
  | { ok: false; questionIndexes: number[]; errors: string[] };

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
    "Return the corrected JSON only. No Markdown, no code fences, no commentary."
  ].join("\n");
}

/** Applies parsed reviews back onto the questions they came from. */
export function applyReviews(
  group: EnrichmentGroup,
  reviews: ReturnType<typeof parseReviewResponse>["reviews"]
): { questions: QuizQuestion[]; errors: string[] } {
  const errors: string[] = [];
  const byNumber = new Map(reviews.map((review) => [review.questionNumber, review]));

  const questions = group.items.map((item) => {
    const review = byNumber.get(item.questionNumber);
    if (!review) {
      errors.push(`No review returned for question ${item.questionNumber}.`);
      return item.question;
    }

    if (review.optionRationales.length !== item.question.options.length) {
      errors.push(
        `Question ${item.questionNumber} returned ${review.optionRationales.length} option rationales for ${item.question.options.length} options.`
      );
      return item.question;
    }

    const { questionNumber: _questionNumber, ...reviewFields } = review;
    return { ...item.question, review: reviewFields };
  });

  return { questions, errors };
}

export async function enrichGroup(
  group: EnrichmentGroup,
  options: {
    connection: AiConnectionSettings;
    kind: AiProviderKind;
    maxRepairAttempts?: number;
    signal?: AbortSignal;
    batchLabel?: string;
    onProgress?: (progress: { chars: number; reasoningChars: number; thinking: boolean }) => void;
  }
): Promise<EnrichmentOutcome> {
  const { connection, kind, signal, batchLabel, onProgress } = options;
  const maxRepairAttempts = options.maxRepairAttempts ?? 2;
  const jsonSchema = buildReviewJsonSchema(group.optionCount);
  // Reviews are far longer than the questions they describe.
  const outputTokenHint = group.items.length * estimateReviewTokens(group.optionCount);

  const messages: AiChatMessage[] = [
    { role: "system", content: REVIEW_SYSTEM_PROMPT },
    {
      role: "user",
      content: buildReviewPrompt({
        items: group.items,
        optionCount: group.optionCount,
        batchLabel
      })
    }
  ];

  let lastErrors: string[] = ["The model did not return a valid review payload."];

  for (let attempt = 0; attempt <= maxRepairAttempts; attempt += 1) {
    if (signal?.aborted) {
      return { ok: false, questionIndexes: group.questionIndexes, errors: ["Run stopped."] };
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
        onDelta: (progress) => onProgress?.(progress)
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Request failed.";
      return {
        ok: false,
        questionIndexes: group.questionIndexes,
        errors: [signal?.aborted ? "Run stopped." : message]
      };
    }

    const parsed = parseReviewResponse(text, group.optionCount);
    if (parsed.success) {
      const applied = applyReviews(group, parsed.reviews);
      if (applied.errors.length === 0) {
        return { ok: true, questionIndexes: group.questionIndexes, questions: applied.questions };
      }
      lastErrors = applied.errors;
    } else {
      lastErrors = parsed.errors;
    }

    if (attempt < maxRepairAttempts) {
      messages.push({ role: "assistant", content: text.slice(0, 12_000) });
      messages.push({ role: "user", content: buildRepairMessage(text, lastErrors) });
    }
  }

  return { ok: false, questionIndexes: group.questionIndexes, errors: lastErrors };
}

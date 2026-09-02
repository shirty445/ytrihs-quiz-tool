import { z } from "zod";
import { createReviewSchema } from "@/lib/quiz/schema";
import type { QuestionReview } from "@/lib/types";

export interface ParsedReview extends QuestionReview {
  questionNumber: number;
}

export interface ParseReviewResult {
  success: boolean;
  reviews: ParsedReview[];
  errors: string[];
}

function normalizeInput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "";
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  return trimmed;
}

function extractLikelyJson(raw: string): string {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  return start >= 0 && end > start ? raw.slice(start, end + 1) : raw;
}

function issuePrefix(path: (string | number)[]): string {
  return path.length === 0 ? "" : `${path.join(".")}: `;
}

function createReviewsSchema(optionCount: number) {
  return z.object({
    reviews: z
      .array(
        createReviewSchema(optionCount).extend({
          questionNumber: z
            .union([z.string(), z.number()])
            .transform((value) => Number(value))
            .refine((value) => Number.isInteger(value) && value >= 1, "questionNumber must be a positive integer")
        })
      )
      .min(1, "reviews must contain at least 1 item")
  });
}

export function parseReviewResponse(rawInput: string, optionCount: number): ParseReviewResult {
  const normalized = normalizeInput(rawInput);
  if (!normalized) {
    return { success: false, reviews: [], errors: ["Paste the AI JSON output before parsing."] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractLikelyJson(normalized));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid JSON";
    return { success: false, reviews: [], errors: [`JSON parse error: ${message}`] };
  }

  const result = createReviewsSchema(optionCount).safeParse(parsed);
  if (!result.success) {
    return {
      success: false,
      reviews: [],
      errors: result.error.issues.map((issue) => `${issuePrefix(issue.path)}${issue.message}`)
    };
  }

  return {
    success: true,
    reviews: result.data.reviews.map((review) => ({
      questionNumber: review.questionNumber,
      coreIdea: review.coreIdea.trim(),
      whyCorrect: review.whyCorrect.trim(),
      optionRationales: review.optionRationales.map((rationale) => rationale.trim()),
      keyFacts: review.keyFacts.map((fact) => fact.trim()).filter((fact) => fact.length > 0),
      memoryHook: review.memoryHook.trim(),
      commonConfusion: review.commonConfusion.trim(),
      sourceQuote: review.sourceQuote.trim()
    })),
    errors: []
  };
}

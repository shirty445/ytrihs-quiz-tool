import { z } from "zod";

const SourceSchema = z.object({
  file: z.string().min(1, "source.file is required"),
  page: z
    .union([z.string(), z.number()])
    .transform((value) => String(value).trim())
    .refine((value) => value.length > 0, "source.page is required"),
  chunkId: z.string().min(1, "source.chunkId is required")
});

/**
 * Deep-review payload attached to a question after the enrichment pass.
 *
 * Optional everywhere so quizzes produced before this feature (and quizzes
 * built through the manual copy/paste flow without enrichment) still validate.
 */
export function createReviewSchema(optionCount: number) {
  return z.object({
    coreIdea: z.string().min(1, "review.coreIdea is required"),
    whyCorrect: z.string().min(1, "review.whyCorrect is required"),
    optionRationales: z
      .array(z.string().min(1, "review.optionRationales entries cannot be empty"))
      .length(optionCount, `review.optionRationales needs ${optionCount} entries, one per option`),
    keyFacts: z.array(z.string().min(1, "review.keyFacts entries cannot be empty")).min(1, "review.keyFacts needs at least 1 item"),
    memoryHook: z.string().min(1, "review.memoryHook is required"),
    commonConfusion: z.string().min(1, "review.commonConfusion is required"),
    sourceQuote: z.string().min(1, "review.sourceQuote is required")
  });
}

export function createQuizSchema(optionCount: number) {
  const QuestionSchema = z
    .object({
      question: z.string().min(1, "question is required"),
      options: z
        .array(z.string().min(1, "options cannot be empty"))
        .length(optionCount, `each question needs ${optionCount} options`),
      correctAnswer: z.string().min(1, "correctAnswer is required"),
      explanation: z.string().min(1, "explanation is required"),
      source: SourceSchema,
      review: createReviewSchema(optionCount).optional()
    })
    .superRefine((value, ctx) => {
      if (!value.options.includes(value.correctAnswer)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["correctAnswer"],
          message: "correctAnswer must match one of the options"
        });
      }
    });

  return z.object({
    questions: z.array(QuestionSchema).min(1, "questions must contain at least 1 item")
  });
}

export type QuizSchemaType = z.infer<ReturnType<typeof createQuizSchema>>;

/**
 * JSON Schema mirror of `createQuizSchema`, used only as a decoding constraint
 * for local models (Ollama `format`, OpenAI-compatible `response_format`).
 *
 * Zod above remains the sole validator. Keep the two in sync by hand: they sit
 * in the same file so drift is visible. Note that "correctAnswer must be one of
 * options" is not expressible in JSON Schema, so the zod superRefine plus the
 * repair loop in lib/ai/run-quiz-generation.ts remain the real guarantee.
 */
export function buildQuizJsonSchema(optionCount: number): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["questions"],
    properties: {
      questions: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["question", "options", "correctAnswer", "explanation", "source"],
          properties: {
            question: { type: "string", minLength: 1 },
            options: {
              type: "array",
              minItems: optionCount,
              maxItems: optionCount,
              items: { type: "string", minLength: 1 }
            },
            correctAnswer: { type: "string", minLength: 1 },
            explanation: { type: "string", minLength: 1 },
            source: {
              type: "object",
              additionalProperties: false,
              required: ["file", "page", "chunkId"],
              properties: {
                file: { type: "string", minLength: 1 },
                page: { type: "string", minLength: 1 },
                chunkId: { type: "string", minLength: 1 }
              }
            }
          }
        }
      }
    }
  };
}

/** JSON Schema mirror of the enrichment response. */
export function buildReviewJsonSchema(optionCount: number): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["reviews"],
    properties: {
      reviews: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "questionNumber",
            "coreIdea",
            "whyCorrect",
            "optionRationales",
            "keyFacts",
            "memoryHook",
            "commonConfusion",
            "sourceQuote"
          ],
          properties: {
            questionNumber: { type: "integer", minimum: 1 },
            coreIdea: { type: "string", minLength: 1 },
            whyCorrect: { type: "string", minLength: 1 },
            optionRationales: {
              type: "array",
              minItems: optionCount,
              maxItems: optionCount,
              items: { type: "string", minLength: 1 }
            },
            keyFacts: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
            memoryHook: { type: "string", minLength: 1 },
            commonConfusion: { type: "string", minLength: 1 },
            sourceQuote: { type: "string", minLength: 1 }
          }
        }
      }
    }
  };
}

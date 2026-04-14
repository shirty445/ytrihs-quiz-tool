import { z } from "zod";

const SourceSchema = z.object({
  file: z.string().min(1, "source.file is required"),
  page: z
    .union([z.string(), z.number()])
    .transform((value) => String(value).trim())
    .refine((value) => value.length > 0, "source.page is required"),
  chunkId: z.string().min(1, "source.chunkId is required")
});

const QuestionSchema = z
  .object({
    question: z.string().min(1, "question is required"),
    options: z.array(z.string().min(1, "options cannot be empty")).length(4, "each question needs 4 options"),
    correctAnswer: z.string().min(1, "correctAnswer is required"),
    explanation: z.string().min(1, "explanation is required"),
    source: SourceSchema
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

export const QuizSchema = z.object({
  questions: z.array(QuestionSchema).min(1, "questions must contain at least 1 item")
});

export type QuizSchemaType = z.infer<typeof QuizSchema>;

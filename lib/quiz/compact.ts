import { z } from "zod";
import type { QuizPayload } from "@/lib/types";

const CompactQuestionSchema = z.tuple([
  z.string().min(1, "compact question text is required"),
  z.array(z.string().min(1, "compact options cannot be empty")).length(4, "compact question needs 4 options"),
  z.union([z.string(), z.number()]),
  z.string().min(1, "compact explanation is required"),
  z.tuple([z.string().min(1), z.union([z.string(), z.number()]), z.string().min(1)])
]);

const CompactQuizSchema = z.object({
  questions: z.array(CompactQuestionSchema).min(1, "compact questions must contain at least 1 item")
});

function issuePrefix(path: (string | number)[]): string {
  if (path.length === 0) {
    return "";
  }

  return `${path.join(".")}: `;
}

function normalizeCorrectIndex(value: string | number): number | null {
  if (typeof value === "number") {
    if (value >= 0 && value <= 3) {
      return value;
    }
    if (value >= 1 && value <= 4) {
      return value - 1;
    }
    return null;
  }

  const normalized = value.trim().toUpperCase();
  if (["A", "B", "C", "D"].includes(normalized)) {
    return normalized.charCodeAt(0) - 65;
  }

  if (/^\d+$/.test(normalized)) {
    const parsed = Number(normalized);
    return normalizeCorrectIndex(parsed);
  }

  return null;
}

export interface CompactParseResult {
  success: boolean;
  data?: QuizPayload;
  errors: string[];
}

export function parseCompactQuizPayload(raw: unknown): CompactParseResult {
  const result = CompactQuizSchema.safeParse(raw);
  if (!result.success) {
    return {
      success: false,
      errors: result.error.issues.map((issue) => `${issuePrefix(issue.path)}${issue.message}`)
    };
  }

  try {
    return {
      success: true,
      data: {
        questions: result.data.questions.map((question) => {
          const correctIndex = normalizeCorrectIndex(question[2]);
          if (correctIndex === null) {
            throw new Error("Compact JSON uses an invalid correct answer index.");
          }

          const page = String(question[4][1]).trim() || "unknown";
          return {
            question: question[0].trim(),
            options: [
              question[1][0].trim(),
              question[1][1].trim(),
              question[1][2].trim(),
              question[1][3].trim()
            ] as [string, string, string, string],
            correctAnswer: question[1][correctIndex].trim(),
            explanation: question[3].trim(),
            source: {
              file: question[4][0].trim(),
              page,
              chunkId: question[4][2].trim()
            }
          };
        })
      },
      errors: []
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid compact JSON";
    return {
      success: false,
      errors: [message]
    };
  }
}

export function tryParseCompactQuizPayload(raw: unknown): QuizPayload | null {
  const result = parseCompactQuizPayload(raw);
  return result.success ? result.data ?? null : null;
}

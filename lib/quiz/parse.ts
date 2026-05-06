import type { QuizPayload, QuizQuestion, ResponseFormat } from "@/lib/types";
import { parseCompactQuizPayload, tryParseCompactQuizPayload } from "@/lib/quiz/compact";
import { createQuizSchema } from "@/lib/quiz/schema";
import type { QuizSchemaType } from "@/lib/quiz/schema";

export interface ParseQuizResult {
  success: boolean;
  data?: QuizPayload;
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

  if (start >= 0 && end > start) {
    return raw.slice(start, end + 1);
  }

  return raw;
}

function issuePrefix(path: (string | number)[]): string {
  if (path.length === 0) {
    return "";
  }
  return `${path.join(".")}: `;
}

function normalizeQuiz(data: QuizSchemaType | QuizPayload): QuizPayload {
  const questions: QuizQuestion[] = data.questions.map((question) => ({
    question: question.question.trim(),
    options: question.options.map((option) => option.trim()),
    correctAnswer: question.correctAnswer.trim(),
    explanation: question.explanation.trim(),
    source: {
      file: question.source.file.trim(),
      page: question.source.page.trim() || "unknown",
      chunkId: question.source.chunkId.trim()
    }
  }));

  return { questions };
}

export function parseQuizResponse(
  rawInput: string,
  responseFormat: ResponseFormat = "standard",
  optionCount = 4
): ParseQuizResult {
  const normalized = normalizeInput(rawInput);
  if (!normalized) {
    return { success: false, errors: ["Paste the AI JSON output before parsing."] };
  }

  const candidate = extractLikelyJson(normalized);
  let parsed: unknown;

  try {
    parsed = JSON.parse(candidate);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid JSON";
    return { success: false, errors: [`JSON parse error: ${message}`] };
  }

  if (responseFormat === "compact") {
    const compactResult = parseCompactQuizPayload(parsed, optionCount);
    if (compactResult.success && compactResult.data) {
      return {
        success: true,
        data: normalizeQuiz(compactResult.data),
        errors: []
      };
    }

    return {
      success: false,
      errors:
        compactResult.errors.length > 0
          ? compactResult.errors
          : ["Compact JSON could not be parsed. Check the selected response format and schema."]
    };
  }

  const result = createQuizSchema(optionCount).safeParse(parsed);
  if (!result.success) {
    try {
      const compactPayload = tryParseCompactQuizPayload(parsed, optionCount);
      if (compactPayload) {
        return {
          success: true,
          data: normalizeQuiz(compactPayload),
          errors: []
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid compact JSON";
      return { success: false, errors: [message] };
    }
  }

  if (!result.success) {
    const errors = result.error.issues.map((issue) => `${issuePrefix(issue.path)}${issue.message}`);
    return { success: false, errors };
  }

  return {
    success: true,
    data: normalizeQuiz(result.data),
    errors: []
  };
}

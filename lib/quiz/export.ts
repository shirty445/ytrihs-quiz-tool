import type { QuizPayload } from "@/lib/types";
import { optionLabels } from "@/lib/quiz/options";

function escapeCsv(value: string): string {
  const normalized = value.replace(/\r?\n/g, " ").trim();
  if (/[",]/.test(normalized)) {
    return `"${normalized.replace(/"/g, '""')}"`;
  }
  return normalized;
}

export function quizToJson(payload: QuizPayload): string {
  return JSON.stringify(payload, null, 2);
}

export function quizToCsv(payload: QuizPayload): string {
  const maxOptionCount = payload.questions.reduce(
    (maxCount, question) => Math.max(maxCount, question.options.length),
    0
  );
  const optionHeaderLabels = optionLabels(maxOptionCount);
  const header = [
    "questionIndex",
    "question",
    ...optionHeaderLabels.map((label) => `option${label}`),
    "correctAnswer",
    "explanation",
    "sourceFile",
    "sourcePage",
    "sourceChunkId"
  ];

  const rows = payload.questions.map((question, index) => [
    String(index + 1),
    question.question,
    ...optionHeaderLabels.map((_, optionIndex) => question.options[optionIndex] ?? ""),
    question.correctAnswer,
    question.explanation,
    question.source.file,
    question.source.page,
    question.source.chunkId
  ]);

  return [header, ...rows]
    .map((row) => row.map((cell) => escapeCsv(String(cell))).join(","))
    .join("\n");
}

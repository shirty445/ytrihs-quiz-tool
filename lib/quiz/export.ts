import type { QuizPayload } from "@/lib/types";

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
  const header = [
    "questionIndex",
    "question",
    "optionA",
    "optionB",
    "optionC",
    "optionD",
    "correctAnswer",
    "explanation",
    "sourceFile",
    "sourcePage",
    "sourceChunkId"
  ];

  const rows = payload.questions.map((question, index) => [
    String(index + 1),
    question.question,
    question.options[0],
    question.options[1],
    question.options[2],
    question.options[3],
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

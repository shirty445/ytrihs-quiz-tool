import type { QuizPayload, QuizQuestion } from "@/lib/types";

export interface MergeQuizResult {
  quiz: QuizPayload;
  addedCount: number;
  duplicateCount: number;
}

function normalizeStem(question: string): string {
  return question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function dedupeQuestions(questions: QuizQuestion[]): MergeQuizResult {
  const seen = new Set<string>();
  const merged: QuizQuestion[] = [];
  let duplicateCount = 0;

  for (const question of questions) {
    const key = normalizeStem(question.question);
    if (seen.has(key)) {
      duplicateCount += 1;
      continue;
    }

    seen.add(key);
    merged.push(question);
  }

  return {
    quiz: { questions: merged },
    addedCount: merged.length,
    duplicateCount
  };
}

export function mergeQuizPayload(
  existingQuiz: QuizPayload | null,
  incomingQuiz: QuizPayload
): MergeQuizResult {
  const existingQuestions = existingQuiz?.questions ?? [];
  const combined = [...existingQuestions, ...incomingQuiz.questions];
  const result = dedupeQuestions(combined);

  return {
    quiz: result.quiz,
    addedCount: result.quiz.questions.length - existingQuestions.length,
    duplicateCount: result.duplicateCount
  };
}

import type { QuizPayload, QuizQualityReport, QuizQuestion } from "@/lib/types";

function positionCounts(questions: QuizQuestion[]): [number, number, number, number] {
  const counts: [number, number, number, number] = [0, 0, 0, 0];

  for (const question of questions) {
    const correctIndex = question.options.findIndex((option) => option === question.correctAnswer);
    if (correctIndex >= 0 && correctIndex <= 3) {
      counts[correctIndex] += 1;
    }
  }

  return counts;
}

function hasDuplicateOptions(question: QuizQuestion): boolean {
  return new Set(question.options.map((option) => option.trim().toLowerCase())).size < question.options.length;
}

function rebalanceQuestion(question: QuizQuestion, targetIndex: number): QuizQuestion {
  const currentIndex = question.options.findIndex((option) => option === question.correctAnswer);
  if (currentIndex < 0) {
    return question;
  }

  const remainingOptions = question.options.filter((_, index) => index !== currentIndex);
  const nextOptions = ["", "", "", ""] as [string, string, string, string];
  nextOptions[targetIndex] = question.correctAnswer;

  let remainingCursor = 0;
  for (let index = 0; index < nextOptions.length; index += 1) {
    if (index === targetIndex) {
      continue;
    }
    nextOptions[index] = remainingOptions[remainingCursor] ?? "";
    remainingCursor += 1;
  }

  return {
    ...question,
    options: nextOptions
  };
}

export function rebalanceAnswerPositions(
  payload: QuizPayload,
  startOffset = 0
): { quiz: QuizPayload; report: QuizQualityReport } {
  const balancedQuestions = payload.questions.map((question, index) =>
    rebalanceQuestion(question, (startOffset + index) % 4)
  );
  const originalCounts = positionCounts(payload.questions);
  const balancedCounts = positionCounts(balancedQuestions);
  const maxOriginalCount = Math.max(...originalCounts);
  const skewDetected = payload.questions.length >= 4 && maxOriginalCount / payload.questions.length >= 0.6;
  const duplicateOptionQuestionCount = payload.questions.filter(hasDuplicateOptions).length;

  return {
    quiz: {
      questions: balancedQuestions
    },
    report: {
      originalCorrectPositionCounts: originalCounts,
      balancedCorrectPositionCounts: balancedCounts,
      skewDetected,
      duplicateOptionQuestionCount
    }
  };
}

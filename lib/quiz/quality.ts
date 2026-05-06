import type { QuizPayload, QuizQualityReport, QuizQuestion } from "@/lib/types";

function positionCounts(questions: QuizQuestion[]): number[] {
  const maxOptionCount = questions.reduce((maxCount, question) => {
    return Math.max(maxCount, question.options.length);
  }, 0);
  const counts = Array.from({ length: maxOptionCount }, () => 0);

  for (const question of questions) {
    const correctIndex = question.options.findIndex((option) => option === question.correctAnswer);
    if (correctIndex >= 0 && correctIndex < counts.length) {
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
  const nextOptions = Array.from({ length: question.options.length }, () => "");
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
    question.options.length > 0 ? rebalanceQuestion(question, (startOffset + index) % question.options.length) : question
  );
  const originalCounts = positionCounts(payload.questions);
  const balancedCounts = positionCounts(balancedQuestions);
  const maxOriginalCount = originalCounts.length > 0 ? Math.max(...originalCounts) : 0;
  const optionCount = originalCounts.length;
  const skewDetected = optionCount > 0 && payload.questions.length >= optionCount && maxOriginalCount / payload.questions.length >= 0.6;
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

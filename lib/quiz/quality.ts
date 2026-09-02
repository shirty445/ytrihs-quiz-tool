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

/**
 * Builds the permutation that moves the correct answer to `targetIndex` while
 * keeping every other option in its relative order.
 *
 * Returned as an explicit index map so that any array running parallel to
 * `options` — notably `review.optionRationales` — can be permuted identically.
 */
function permutationFor(question: QuizQuestion, targetIndex: number): number[] | null {
  const currentIndex = question.options.findIndex((option) => option === question.correctAnswer);
  if (currentIndex < 0) {
    return null;
  }

  const remainingIndexes = question.options
    .map((_, index) => index)
    .filter((index) => index !== currentIndex);

  const permutation = Array.from({ length: question.options.length }, () => -1);
  permutation[targetIndex] = currentIndex;

  let cursor = 0;
  for (let index = 0; index < permutation.length; index += 1) {
    if (index === targetIndex) {
      continue;
    }
    permutation[index] = remainingIndexes[cursor];
    cursor += 1;
  }

  return permutation;
}

function rebalanceQuestion(question: QuizQuestion, targetIndex: number): QuizQuestion {
  const permutation = permutationFor(question, targetIndex);
  if (!permutation) {
    return question;
  }

  const options = permutation.map((sourceIndex) => question.options[sourceIndex] ?? "");
  const review = question.review;

  if (!review || review.optionRationales.length !== question.options.length) {
    return { ...question, options };
  }

  return {
    ...question,
    options,
    review: {
      ...review,
      optionRationales: permutation.map((sourceIndex) => review.optionRationales[sourceIndex] ?? "")
    }
  };
}

/**
 * Target slots for a run of questions: each slot used as evenly as possible,
 * then shuffled.
 *
 * A plain `(offset + index) % optionCount` also balances the distribution, but
 * produces a visible A,B,C,D,A,B,C,D cycle that a learner can ride instead of
 * reading the question.
 */
function balancedTargetSlots(questionCount: number, optionCount: number, seed: number): number[] {
  if (optionCount <= 0) {
    return Array.from({ length: questionCount }, () => 0);
  }

  const slots: number[] = [];
  for (let index = 0; index < questionCount; index += 1) {
    slots.push(index % optionCount);
  }

  // Deterministic per-run shuffle (mulberry32) so repeated parses of the same
  // batch behave consistently while still breaking the cycle.
  let state = (seed * 0x9e3779b9 + 0x85ebca6b) >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  for (let index = slots.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [slots[index], slots[swapIndex]] = [slots[swapIndex], slots[index]];
  }

  return slots;
}

export function rebalanceAnswerPositions(
  payload: QuizPayload,
  startOffset = 0
): { quiz: QuizPayload; report: QuizQualityReport } {
  const dominantOptionCount = payload.questions.reduce(
    (maxCount, question) => Math.max(maxCount, question.options.length),
    0
  );
  const targetSlots = balancedTargetSlots(payload.questions.length, dominantOptionCount, startOffset);

  const balancedQuestions = payload.questions.map((question, index) => {
    if (question.options.length === 0) {
      return question;
    }
    return rebalanceQuestion(question, targetSlots[index] % question.options.length);
  });

  const originalCounts = positionCounts(payload.questions);
  const balancedCounts = positionCounts(balancedQuestions);
  const maxOriginalCount = originalCounts.length > 0 ? Math.max(...originalCounts) : 0;
  const optionCount = originalCounts.length;
  const skewDetected =
    optionCount > 0 &&
    payload.questions.length >= optionCount &&
    maxOriginalCount / payload.questions.length >= 0.6;
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

import type { OptionCount, QuizPayload } from "@/lib/types";

export const OPTION_COUNT_OPTIONS: OptionCount[] = [4, 5];

export function normalizeOptionCount(value: number): OptionCount {
  return value === 5 ? 5 : 4;
}

export function optionLabels(count: number): string[] {
  const normalizedCount = Math.max(1, Math.min(26, Math.round(count)));
  return Array.from({ length: normalizedCount }, (_, index) => String.fromCharCode(65 + index));
}

export function formatOptionRange(count: number): string {
  const labels = optionLabels(count);
  if (labels.length === 0) {
    return "";
  }
  return labels.length === 1 ? labels[0] : `${labels[0]}-${labels[labels.length - 1]}`;
}

export function quizOptionCounts(payload: QuizPayload): number[] {
  return Array.from(new Set(payload.questions.map((question) => question.options.length))).sort((a, b) => a - b);
}

export function describeAnswerChoiceCounts(payload: QuizPayload): string {
  const counts = quizOptionCounts(payload);

  if (counts.length === 0) {
    return "No answer choices";
  }

  if (counts.length === 1) {
    return `${counts[0]} answer choice${counts[0] === 1 ? "" : "s"} each`;
  }

  return `${counts[0]}-${counts[counts.length - 1]} answer choices`;
}

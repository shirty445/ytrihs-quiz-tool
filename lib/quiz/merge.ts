import { STOP_WORDS, tokenize } from "@/lib/text/compression";
import type { QuizPayload, QuizQuestion } from "@/lib/types";

export interface MergeQuizResult {
  quiz: QuizPayload;
  addedCount: number;
  duplicateCount: number;
}

/** Stems whose token sets overlap at least this much are treated as the same question. */
export const NEAR_DUPLICATE_THRESHOLD = 0.82;

function normalizeStem(question: string): string {
  return question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function contentTokens(question: string): Set<string> {
  return new Set(tokenize(question).filter((token) => !STOP_WORDS.has(token)));
}

export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) {
    return a.size === b.size ? 1 : 0;
  }

  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) {
      intersection += 1;
    }
  }

  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

interface DedupeEntry {
  tokens: Set<string>;
  index: number;
}

/**
 * Exact-stem dedupe plus a near-duplicate pass.
 *
 * "What is the capital of France?" and "France's capital is which city?" are
 * byte-different but the same question; exact matching alone lets both through.
 * Candidates are looked up through an inverted index on each stem's rarest
 * tokens so a large bank does not degrade into an O(n^2) comparison.
 */
function dedupeQuestions(questions: QuizQuestion[]): MergeQuizResult {
  const seenStems = new Set<string>();
  const tokenIndex = new Map<string, DedupeEntry[]>();
  const tokenFrequency = new Map<string, number>();
  const merged: QuizQuestion[] = [];
  let duplicateCount = 0;

  for (const question of questions) {
    const tokens = contentTokens(question.question);
    for (const token of tokens) {
      tokenFrequency.set(token, (tokenFrequency.get(token) ?? 0) + 1);
    }
  }

  const rarestTokens = (tokens: Set<string>): string[] =>
    [...tokens].sort((a, b) => (tokenFrequency.get(a) ?? 0) - (tokenFrequency.get(b) ?? 0)).slice(0, 3);

  for (const question of questions) {
    const stem = normalizeStem(question.question);
    if (seenStems.has(stem)) {
      duplicateCount += 1;
      continue;
    }

    const tokens = contentTokens(question.question);
    const candidates = new Map<number, DedupeEntry>();
    for (const token of rarestTokens(tokens)) {
      for (const entry of tokenIndex.get(token) ?? []) {
        candidates.set(entry.index, entry);
      }
    }

    let isNearDuplicate = false;
    for (const candidate of candidates.values()) {
      if (jaccardSimilarity(tokens, candidate.tokens) >= NEAR_DUPLICATE_THRESHOLD) {
        isNearDuplicate = true;
        break;
      }
    }

    if (isNearDuplicate) {
      duplicateCount += 1;
      continue;
    }

    seenStems.add(stem);
    const entry: DedupeEntry = { tokens, index: merged.length };
    merged.push(question);

    for (const token of rarestTokens(tokens)) {
      const bucket = tokenIndex.get(token) ?? [];
      bucket.push(entry);
      tokenIndex.set(token, bucket);
    }
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

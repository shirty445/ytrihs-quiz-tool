import { contentTokens, jaccardSimilarity, NEAR_DUPLICATE_THRESHOLD } from "@/lib/quiz/merge";
import type { QuizPayload, QuizQuestion, SourceChunk } from "@/lib/types";

export type AuditFlag =
  | "answer_orphaned"
  | "duplicate_options"
  | "longest_option_is_answer"
  | "negative_stem"
  | "absolute_in_distractor"
  | "meta_option"
  | "stem_verbatim_from_source"
  | "unknown_chunk_id"
  | "near_duplicate"
  | "option_length_skew";

export interface QuestionAudit {
  index: number;
  flags: AuditFlag[];
  notes: string[];
}

export interface AuditReport {
  questions: QuestionAudit[];
  flaggedIndexes: number[];
  counts: Record<AuditFlag, number>;
  /** Share of questions where the correct answer is the longest option. */
  longestAnswerRate: number;
  /** Above this, the bank is gameable by picking the longest option. */
  longestAnswerRateIsSuspicious: boolean;
}

const META_OPTION_PATTERNS = [
  /\ball of the above\b/i,
  /\bnone of the above\b/i,
  /\bboth [a-e] and [a-e]\b/i,
  /\ball of these\b/i,
  /\bnone of these\b/i
];

const ABSOLUTE_PATTERN = /\b(always|never|all|none|every|no)\b/i;
const NEGATIVE_STEM_PATTERN = /\b(not|except|least|incorrect|false)\b/i;

export const AUDIT_FLAG_LABELS: Record<AuditFlag, string> = {
  answer_orphaned: "Correct answer is not one of the options",
  duplicate_options: "Two options repeat the same text",
  longest_option_is_answer: "Correct answer is the longest option",
  negative_stem: "Negative or 'except' stem",
  absolute_in_distractor: "Distractor uses an absolute qualifier",
  meta_option: "Uses 'All/None of the above'",
  stem_verbatim_from_source: "Stem is copied near-verbatim from the source",
  unknown_chunk_id: "Cites a chunkId that is not in the source packet",
  near_duplicate: "Near-duplicate of another question",
  option_length_skew: "Correct answer is far longer than the distractors"
};

function normalizedWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 0);
}

function ngrams(words: string[], size: number): Set<string> {
  const grams = new Set<string>();
  for (let index = 0; index + size <= words.length; index += 1) {
    grams.add(words.slice(index, index + size).join(" "));
  }
  return grams;
}

/** Share of the stem's 5-grams that appear verbatim in the source chunk. */
function verbatimOverlap(stem: string, sourceText: string): number {
  const stemWords = normalizedWords(stem);
  if (stemWords.length < 8) {
    return 0;
  }

  const stemGrams = ngrams(stemWords, 5);
  if (stemGrams.size === 0) {
    return 0;
  }

  const sourceGrams = ngrams(normalizedWords(sourceText), 5);
  let hits = 0;
  for (const gram of stemGrams) {
    if (sourceGrams.has(gram)) {
      hits += 1;
    }
  }

  return hits / stemGrams.size;
}

/**
 * True only when the correct answer is STRICTLY longer than every distractor.
 *
 * Ties do not make a quiz gameable — if all four options are the same length,
 * "pick the longest" tells the learner nothing. Counting ties pushed the
 * bank-level rate to 100% on perfectly well-formed questions.
 */
function longestOptionIsAnswer(question: QuizQuestion): boolean {
  if (question.options.length < 2) {
    return false;
  }

  const answerLength = question.correctAnswer.length;
  return question.options.every(
    (option) => option === question.correctAnswer || option.length < answerLength
  );
}

function optionLengthSkew(question: QuizQuestion): boolean {
  const distractors = question.options.filter((option) => option !== question.correctAnswer);
  if (distractors.length === 0) {
    return false;
  }
  const averageDistractor =
    distractors.reduce((sum, option) => sum + option.length, 0) / distractors.length;
  return averageDistractor > 0 && question.correctAnswer.length > averageDistractor * 1.8;
}

export function auditQuiz(quiz: QuizPayload | null, chunks: SourceChunk[]): AuditReport {
  const questions = quiz?.questions ?? [];
  const chunkText = new Map(chunks.map((chunk) => [chunk.chunkId, chunk.rawText]));
  const knownChunkIds = new Set(chunks.map((chunk) => chunk.chunkId));
  const tokenSets = questions.map((question) => contentTokens(question.question));

  const counts = Object.keys(AUDIT_FLAG_LABELS).reduce(
    (accumulator, flag) => ({ ...accumulator, [flag]: 0 }),
    {} as Record<AuditFlag, number>
  );

  let longestAnswerHits = 0;

  const audits: QuestionAudit[] = questions.map((question, index) => {
    const flags: AuditFlag[] = [];
    const notes: string[] = [];

    if (!question.options.includes(question.correctAnswer)) {
      flags.push("answer_orphaned");
      notes.push(`correctAnswer "${question.correctAnswer}" matches none of the options.`);
    }

    if (
      new Set(question.options.map((option) => option.trim().toLowerCase())).size <
      question.options.length
    ) {
      flags.push("duplicate_options");
    }

    if (longestOptionIsAnswer(question)) {
      longestAnswerHits += 1;
      if (optionLengthSkew(question)) {
        flags.push("option_length_skew");
      }
    }

    if (NEGATIVE_STEM_PATTERN.test(question.question)) {
      flags.push("negative_stem");
    }

    if (question.options.some((option) => META_OPTION_PATTERNS.some((pattern) => pattern.test(option)))) {
      flags.push("meta_option");
    }

    const distractorsWithAbsolutes = question.options.filter(
      (option) => option !== question.correctAnswer && ABSOLUTE_PATTERN.test(option)
    );
    if (distractorsWithAbsolutes.length > 0 && !ABSOLUTE_PATTERN.test(question.correctAnswer)) {
      flags.push("absolute_in_distractor");
      notes.push("Absolute wording appears only in distractors, which gives the answer away.");
    }

    if (question.source.chunkId && !knownChunkIds.has(question.source.chunkId) && chunks.length > 0) {
      flags.push("unknown_chunk_id");
      notes.push(`Cited chunkId "${question.source.chunkId}" is not in the source packet.`);
    }

    const sourceText = chunkText.get(question.source.chunkId);
    if (sourceText && verbatimOverlap(question.question, sourceText) >= 0.5) {
      flags.push("stem_verbatim_from_source");
      notes.push("Stem repeats the source phrasing, so it tests wording recall rather than understanding.");
    }

    for (let other = 0; other < index; other += 1) {
      if (jaccardSimilarity(tokenSets[index], tokenSets[other]) >= NEAR_DUPLICATE_THRESHOLD) {
        flags.push("near_duplicate");
        notes.push(`Very similar to question ${other + 1}.`);
        break;
      }
    }

    for (const flag of flags) {
      counts[flag] += 1;
    }

    return { index, flags, notes };
  });

  const longestAnswerRate = questions.length === 0 ? 0 : longestAnswerHits / questions.length;

  // With 4 options, chance alone puts the answer longest ~25% of the time.
  // Sustained above 45% and the quiz is answerable without reading it.
  const longestAnswerRateIsSuspicious = questions.length >= 8 && longestAnswerRate > 0.45;
  counts.longest_option_is_answer = longestAnswerHits;

  return {
    questions: audits,
    flaggedIndexes: audits.filter((audit) => audit.flags.length > 0).map((audit) => audit.index),
    counts,
    longestAnswerRate,
    longestAnswerRateIsSuspicious
  };
}

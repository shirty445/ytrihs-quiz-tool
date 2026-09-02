import { mergeQuizPayload } from "@/lib/quiz/merge";
import { formatOptionRange } from "@/lib/quiz/options";
import { parseQuizResponse } from "@/lib/quiz/parse";
import { rebalanceAnswerPositions } from "@/lib/quiz/quality";
import type { PromptBatchState, QuizPayload } from "@/lib/types";

export interface IngestFailure {
  ok: false;
  errors: string[];
}

export interface IngestSuccess {
  ok: true;
  quiz: QuizPayload;
  parsedQuestionCount: number;
  addedCount: number;
  duplicateCount: number;
  qualityNotes: string[];
}

export type IngestBatchResult = IngestFailure | IngestSuccess;

/**
 * Shared parse -> rebalance -> merge pipeline.
 *
 * Both the manual paste flow and the local-AI runner go through this so the two
 * paths cannot drift apart.
 */
export function ingestBatchResponse(input: {
  quiz: QuizPayload | null;
  batch: PromptBatchState;
  rawResponse: string;
}): IngestBatchResult {
  const { quiz, batch, rawResponse } = input;

  const parsed = parseQuizResponse(rawResponse, batch.responseFormat, batch.optionCount);
  if (!parsed.success || !parsed.data) {
    return { ok: false, errors: parsed.errors };
  }

  const parsedQuestionCount = parsed.data.questions.length;
  const rebalanced = rebalanceAnswerPositions(parsed.data, quiz?.questions.length ?? 0);
  const mergeResult = mergeQuizPayload(quiz, rebalanced.quiz);
  const qualityNotes: string[] = [];
  const countDifference = parsedQuestionCount - batch.questionCount;

  if (countDifference !== 0) {
    qualityNotes.push(
      countDifference > 0
        ? `Accepted ${parsedQuestionCount} questions for a target of ${batch.questionCount} (${countDifference} over target).`
        : `Accepted ${parsedQuestionCount} questions for a target of ${batch.questionCount} (${Math.abs(countDifference)} under target).`
    );
  }

  if (rebalanced.report.skewDetected) {
    qualityNotes.push(
      `Detected answer-position skew and redistributed correct options across ${formatOptionRange(batch.optionCount)}.`
    );
  }

  if (rebalanced.report.duplicateOptionQuestionCount > 0) {
    qualityNotes.push(
      `Detected ${rebalanced.report.duplicateOptionQuestionCount} question${rebalanced.report.duplicateOptionQuestionCount === 1 ? "" : "s"} with duplicate option text. Review before export.`
    );
  }

  return {
    ok: true,
    quiz: mergeResult.quiz,
    parsedQuestionCount,
    addedCount: mergeResult.addedCount,
    duplicateCount: mergeResult.duplicateCount,
    qualityNotes
  };
}

export function describeIngestOutcome(batchNumber: number, outcome: IngestSuccess): string {
  const { parsedQuestionCount, addedCount, duplicateCount, qualityNotes } = outcome;

  return `Prompt ${batchNumber} accepted ${parsedQuestionCount} question${parsedQuestionCount === 1 ? "" : "s"} and added ${addedCount} question${addedCount === 1 ? "" : "s"}${duplicateCount > 0 ? ` while skipping ${duplicateCount} duplicate${duplicateCount === 1 ? "" : "s"}` : ""}.${qualityNotes.length > 0 ? ` ${qualityNotes.join(" ")}` : ""}`;
}

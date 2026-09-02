import { normalizeQuestionsPerPrompt } from "@/lib/prompt/modes";
import type {
  ChunkOrdering,
  CoverageMode,
  PromptBatch,
  PromptDensity,
  ResponseFormat,
  SourceChunk,
  SourceDetail
} from "@/lib/types";

interface MutablePromptBatch {
  chunks: SourceChunk[];
  estimatedChars: number;
  questionCount: number;
}

function emptyBatch(): MutablePromptBatch {
  return {
    chunks: [],
    estimatedChars: 0,
    questionCount: 0
  };
}

function uniqueSourceFiles(chunks: SourceChunk[]): string[] {
  return Array.from(new Set(chunks.map((chunk) => chunk.fileName)));
}

export function sourceCharBudgetPerPrompt(input: {
  questionsPerPrompt: number;
  promptDensity: PromptDensity;
  responseFormat: ResponseFormat;
  sourceDetail?: SourceDetail;
}): number {
  const normalizedQuestionsPerPrompt = normalizeQuestionsPerPrompt(input.questionsPerPrompt);
  const baseBudget = 6500;
  const questionMultiplier = Math.min(3.2, Math.max(0.9, 0.6 + normalizedQuestionsPerPrompt / 10));
  const densityMultiplier =
    input.promptDensity === "light" ? 0.85 : input.promptDensity === "dense" ? 1.2 : 1;
  const responseFormatMultiplier = input.responseFormat === "compact" ? 1.35 : 1;
  // Full-detail packets ship raw chunk text instead of the lossy 420-char
  // summary, so the budget has to grow with them. Local models have the
  // context for it; the copy/paste flow keeps the tighter compressed budget.
  const detailMultiplier = input.sourceDetail === "full" ? 2.6 : 1;

  return Math.round(
    baseBudget * questionMultiplier * densityMultiplier * responseFormatMultiplier * detailMultiplier
  );
}

/** Chars this chunk contributes to a prompt at the given detail level. */
export function chunkPromptChars(chunk: SourceChunk, sourceDetail: SourceDetail): number {
  return sourceDetail === "full" ? chunk.rawText.length : chunk.compressedText.length;
}

function distributeBalancedChunks(
  chunks: SourceChunk[],
  promptCount: number,
  sourceDetail: SourceDetail
): MutablePromptBatch[] {
  const buckets = Array.from({ length: promptCount }, () => emptyBatch());

  for (const chunk of chunks) {
    let lightestIndex = 0;
    for (let index = 1; index < buckets.length; index += 1) {
      if (buckets[index].estimatedChars < buckets[lightestIndex].estimatedChars) {
        lightestIndex = index;
      }
    }

    buckets[lightestIndex].chunks.push(chunk);
    buckets[lightestIndex].estimatedChars += chunkPromptChars(chunk, sourceDetail);
  }

  return buckets;
}

function distributeSequentialChunks(
  chunks: SourceChunk[],
  promptCount: number,
  sourceDetail: SourceDetail
): MutablePromptBatch[] {
  const buckets = Array.from({ length: promptCount }, () => emptyBatch());
  const totalChars = chunks.reduce((sum, chunk) => sum + chunkPromptChars(chunk, sourceDetail), 0);
  const targetCharsPerBucket = totalChars / Math.max(promptCount, 1);
  let bucketIndex = 0;
  let nextBucketThreshold = targetCharsPerBucket;

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
    const chunk = chunks[chunkIndex];
    const currentBucket = buckets[bucketIndex];
    const remainingBuckets = promptCount - bucketIndex - 1;
    const remainingChunks = chunks.length - chunkIndex;

    const chunkChars = chunkPromptChars(chunk, sourceDetail);

    if (
      bucketIndex < promptCount - 1 &&
      currentBucket.chunks.length > 0 &&
      currentBucket.estimatedChars + chunkChars > nextBucketThreshold &&
      remainingChunks > remainingBuckets
    ) {
      bucketIndex += 1;
      nextBucketThreshold += targetCharsPerBucket;
    }

    buckets[bucketIndex].chunks.push(chunk);
    buckets[bucketIndex].estimatedChars += chunkChars;
  }

  return buckets;
}

function shuffleChunks(chunks: SourceChunk[]): SourceChunk[] {
  const shuffled = [...chunks];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return shuffled;
}

function orderChunks(chunks: SourceChunk[], chunkOrdering: ChunkOrdering): SourceChunk[] {
  switch (chunkOrdering) {
    case "page_order":
      return [...chunks].sort((a, b) => a.sourceOrder - b.sourceOrder);
    case "random":
      return shuffleChunks(chunks);
    case "best_match":
    default:
      return [...chunks].sort((a, b) => b.score - a.score);
  }
}

function distributeChunks(
  chunks: SourceChunk[],
  promptCount: number,
  chunkOrdering: ChunkOrdering,
  sourceDetail: SourceDetail
): MutablePromptBatch[] {
  return chunkOrdering === "best_match"
    ? distributeBalancedChunks(chunks, promptCount, sourceDetail)
    : distributeSequentialChunks(chunks, promptCount, sourceDetail);
}

function maxEstimatedChars(buckets: MutablePromptBatch[]): number {
  return buckets.reduce((maxChars, bucket) => Math.max(maxChars, bucket.estimatedChars), 0);
}

/**
 * Gives every empty bucket a chunk by cycling through the source in order,
 * so a prompt count driven by the question target is never silently reduced
 * to the number of available chunks.
 */
function fillEmptyBuckets(
  buckets: MutablePromptBatch[],
  orderedChunks: SourceChunk[],
  sourceDetail: SourceDetail
): void {
  if (orderedChunks.length === 0) {
    return;
  }

  let cursor = 0;
  for (const bucket of buckets) {
    if (bucket.chunks.length > 0) {
      continue;
    }
    const chunk = orderedChunks[cursor % orderedChunks.length];
    cursor += 1;
    bucket.chunks.push(chunk);
    bucket.estimatedChars += chunkPromptChars(chunk, sourceDetail);
  }
}

export interface PromptPlan {
  batches: PromptBatch[];
  /** Sum of every batch's question target. */
  plannedQuestionCount: number;
  /** Question count needed to give every chunk at least one question. */
  fullCoverageQuestionCount: number;
  /** Chunks that reached a batch. */
  coveredChunkCount: number;
  /** Chunks that reached no batch at all (target_first mode only). */
  droppedChunkCount: number;
}

/**
 * Hands out `total` questions across buckets: one each first, then the
 * remainder in proportion to how much source text each bucket holds, so dense
 * material gets more questions than thin material.
 */
function allocateQuestions(
  buckets: MutablePromptBatch[],
  total: number,
  maxPerBucket: number,
  floorPerChunk = false
): void {
  if (buckets.length === 0) {
    return;
  }

  let remaining = total;

  for (const bucket of buckets) {
    if (remaining === 0) {
      break;
    }
    // Coverage-first gives each bucket a question per chunk it holds, so no
    // chunk sits in a prompt without a question asked about it.
    const floor = Math.min(
      floorPerChunk ? Math.max(1, bucket.chunks.length) : 1,
      maxPerBucket,
      remaining
    );
    bucket.questionCount = floor;
    remaining -= floor;
  }

  if (remaining <= 0) {
    return;
  }

  const totalChars = buckets.reduce((sum, bucket) => sum + bucket.estimatedChars, 0);
  if (totalChars > 0) {
    const shares = buckets.map((bucket) => (bucket.estimatedChars / totalChars) * remaining);

    for (let index = 0; index < buckets.length && remaining > 0; index += 1) {
      const headroom = maxPerBucket - buckets[index].questionCount;
      const share = Math.min(Math.floor(shares[index]), headroom, remaining);
      if (share > 0) {
        buckets[index].questionCount += share;
        remaining -= share;
      }
    }
  }

  // Round-robin whatever proportional rounding left over.
  while (remaining > 0) {
    let allocatedThisPass = false;
    for (const bucket of buckets) {
      if (remaining === 0) {
        break;
      }
      if (bucket.questionCount >= maxPerBucket) {
        continue;
      }
      bucket.questionCount += 1;
      remaining -= 1;
      allocatedThisPass = true;
    }

    if (!allocatedThisPass) {
      break;
    }
  }
}

export function buildPromptBatches(
  chunks: SourceChunk[],
  targetQuestionCount: number,
  options: {
    questionsPerPrompt: number;
    promptDensity: PromptDensity;
    responseFormat: ResponseFormat;
    chunkOrdering?: ChunkOrdering;
    sourceDetail?: SourceDetail;
    coverageMode?: CoverageMode;
  }
): PromptPlan {
  const empty: PromptPlan = {
    batches: [],
    plannedQuestionCount: 0,
    fullCoverageQuestionCount: 0,
    coveredChunkCount: 0,
    droppedChunkCount: 0
  };

  if (chunks.length === 0 || targetQuestionCount <= 0) {
    return empty;
  }

  const sourceDetail = options.sourceDetail ?? "compressed";
  const coverageMode = options.coverageMode ?? "coverage_first";
  const chunkOrdering = options.chunkOrdering ?? "best_match";
  const normalizedQuestionsPerPrompt = normalizeQuestionsPerPrompt(options.questionsPerPrompt);
  const maxSourceCharsPerPrompt = sourceCharBudgetPerPrompt({ ...options, sourceDetail });
  const orderedChunks = orderChunks(chunks, chunkOrdering);

  // A chunk only counts as covered when it can produce a question of its own.
  // Sizing coverage by bucket count instead would call a 9-chunk bucket with
  // one question "fully covered" while eight of its chunks produced nothing.
  const fullCoverageQuestionCount = orderedChunks.length;

  // Coverage-first treats the requested count as a floor rather than a ceiling.
  const effectiveQuestionCount =
    coverageMode === "coverage_first"
      ? Math.max(targetQuestionCount, fullCoverageQuestionCount)
      : targetQuestionCount;

  let promptCount = Math.max(1, Math.ceil(effectiveQuestionCount / normalizedQuestionsPerPrompt));
  let buckets = distributeChunks(orderedChunks, promptCount, chunkOrdering, sourceDetail);

  while (promptCount < orderedChunks.length && maxEstimatedChars(buckets) > maxSourceCharsPerPrompt) {
    promptCount += 1;
    buckets = distributeChunks(orderedChunks, promptCount, chunkOrdering, sourceDetail);
  }

  /*
   * Asking for more questions than one pass over the source can hold is a
   * normal request: 25 questions from 3 chunks means asking several different
   * things about each chunk. Distribution only ever hands a chunk to one
   * bucket, so without this the surplus buckets end up empty, get filtered
   * out, and the plan silently caps at chunkCount * questionsPerPrompt --
   * which is why a target of 25 quietly became 15.
   *
   * Refilling empty buckets by cycling the chunk list lets the extra prompts
   * revisit the same material. The prompt already carries the accepted
   * questions from overlapping chunks, so the model is told what not to repeat.
   */
  fillEmptyBuckets(buckets, orderedChunks, sourceDetail);

  const usedBuckets = buckets.filter((bucket) => bucket.chunks.length > 0);

  allocateQuestions(
    usedBuckets,
    effectiveQuestionCount,
    normalizedQuestionsPerPrompt,
    coverageMode === "coverage_first"
  );

  const activeBuckets = usedBuckets.filter((bucket) => bucket.questionCount > 0);

  /*
   * Being handed to a prompt is not the same as getting a question. A batch
   * holding 18 chunks but allowed only 5 questions can ask about at most 5 of
   * them, so counting every chunk in every active batch overstated coverage --
   * it reported "0 chunks uncovered" for a target that plainly could not reach
   * them all. Cap each batch's contribution at its question count.
   */
  const distinctChunkIds = new Set<string>();
  let coverableChunkCount = 0;
  for (const bucket of activeBuckets) {
    for (const chunk of bucket.chunks) {
      distinctChunkIds.add(chunk.chunkId);
    }
    coverableChunkCount += Math.min(bucket.questionCount, bucket.chunks.length);
  }

  const coveredChunkCount = Math.min(coverableChunkCount, distinctChunkIds.size);
  const droppedChunkCount = Math.max(0, orderedChunks.length - coveredChunkCount);

  const batches = activeBuckets.map((bucket, index) => ({
    id: `prompt-batch-${index + 1}`,
    batchNumber: index + 1,
    questionCount: bucket.questionCount,
    chunkCount: bucket.chunks.length,
    estimatedChars: bucket.estimatedChars,
    sourceFiles: uniqueSourceFiles(bucket.chunks),
    chunks: bucket.chunks
  }));

  return {
    batches,
    plannedQuestionCount: batches.reduce((sum, batch) => sum + batch.questionCount, 0),
    fullCoverageQuestionCount,
    coveredChunkCount,
    droppedChunkCount
  };
}

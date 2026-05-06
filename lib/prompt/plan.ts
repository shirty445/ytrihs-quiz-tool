import { normalizeQuestionsPerPrompt } from "@/lib/prompt/modes";
import type {
  ChunkOrdering,
  PromptBatch,
  PromptDensity,
  ResponseFormat,
  SourceChunk
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
}): number {
  const normalizedQuestionsPerPrompt = normalizeQuestionsPerPrompt(input.questionsPerPrompt);
  const baseBudget = 6500;
  const questionMultiplier = Math.min(3.2, Math.max(0.9, 0.6 + normalizedQuestionsPerPrompt / 10));
  const densityMultiplier =
    input.promptDensity === "light" ? 0.85 : input.promptDensity === "dense" ? 1.2 : 1;
  const responseFormatMultiplier = input.responseFormat === "compact" ? 1.35 : 1;

  return Math.round(baseBudget * questionMultiplier * densityMultiplier * responseFormatMultiplier);
}

function distributeBalancedChunks(chunks: SourceChunk[], promptCount: number): MutablePromptBatch[] {
  const buckets = Array.from({ length: promptCount }, () => emptyBatch());

  for (const chunk of chunks) {
    let lightestIndex = 0;
    for (let index = 1; index < buckets.length; index += 1) {
      if (buckets[index].estimatedChars < buckets[lightestIndex].estimatedChars) {
        lightestIndex = index;
      }
    }

    buckets[lightestIndex].chunks.push(chunk);
    buckets[lightestIndex].estimatedChars += chunk.compressedText.length;
  }

  return buckets;
}

function distributeSequentialChunks(chunks: SourceChunk[], promptCount: number): MutablePromptBatch[] {
  const buckets = Array.from({ length: promptCount }, () => emptyBatch());
  const totalChars = chunks.reduce((sum, chunk) => sum + chunk.compressedText.length, 0);
  const targetCharsPerBucket = totalChars / Math.max(promptCount, 1);
  let bucketIndex = 0;
  let nextBucketThreshold = targetCharsPerBucket;

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
    const chunk = chunks[chunkIndex];
    const currentBucket = buckets[bucketIndex];
    const remainingBuckets = promptCount - bucketIndex - 1;
    const remainingChunks = chunks.length - chunkIndex;

    if (
      bucketIndex < promptCount - 1 &&
      currentBucket.chunks.length > 0 &&
      currentBucket.estimatedChars + chunk.compressedText.length > nextBucketThreshold &&
      remainingChunks > remainingBuckets
    ) {
      bucketIndex += 1;
      nextBucketThreshold += targetCharsPerBucket;
    }

    buckets[bucketIndex].chunks.push(chunk);
    buckets[bucketIndex].estimatedChars += chunk.compressedText.length;
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
  chunkOrdering: ChunkOrdering
): MutablePromptBatch[] {
  return chunkOrdering === "best_match"
    ? distributeBalancedChunks(chunks, promptCount)
    : distributeSequentialChunks(chunks, promptCount);
}

function maxEstimatedChars(buckets: MutablePromptBatch[]): number {
  return buckets.reduce((maxChars, bucket) => Math.max(maxChars, bucket.estimatedChars), 0);
}

export function buildPromptBatches(
  chunks: SourceChunk[],
  targetQuestionCount: number,
  options: {
    questionsPerPrompt: number;
    promptDensity: PromptDensity;
    responseFormat: ResponseFormat;
    chunkOrdering?: ChunkOrdering;
  }
): PromptBatch[] {
  if (chunks.length === 0 || targetQuestionCount <= 0) {
    return [];
  }

  const normalizedQuestionsPerPrompt = normalizeQuestionsPerPrompt(options.questionsPerPrompt);
  const promptCountByQuestions = Math.ceil(targetQuestionCount / normalizedQuestionsPerPrompt);
  const maxSourceCharsPerPrompt = sourceCharBudgetPerPrompt(options);
  const orderedChunks = orderChunks(chunks, options.chunkOrdering ?? "best_match");
  let promptCount = Math.max(1, promptCountByQuestions);
  let buckets = distributeChunks(orderedChunks, promptCount, options.chunkOrdering ?? "best_match");

  while (promptCount < orderedChunks.length && maxEstimatedChars(buckets) > maxSourceCharsPerPrompt) {
    promptCount += 1;
    buckets = distributeChunks(orderedChunks, promptCount, options.chunkOrdering ?? "best_match");
  }

  const usedBuckets = buckets.filter((bucket) => bucket.chunks.length > 0);
  let remainingQuestions = targetQuestionCount;

  while (remainingQuestions > 0) {
    let allocatedThisPass = false;
    for (const bucket of usedBuckets) {
      if (remainingQuestions === 0) {
        break;
      }
      if (bucket.questionCount >= normalizedQuestionsPerPrompt) {
        continue;
      }

      bucket.questionCount += 1;
      remainingQuestions -= 1;
      allocatedThisPass = true;
    }

    if (!allocatedThisPass) {
      break;
    }
  }

  return usedBuckets
    .filter((bucket) => bucket.questionCount > 0)
    .map((bucket, index) => ({
      id: `prompt-batch-${index + 1}`,
      batchNumber: index + 1,
      questionCount: bucket.questionCount,
      chunkCount: bucket.chunks.length,
      estimatedChars: bucket.estimatedChars,
      sourceFiles: uniqueSourceFiles(bucket.chunks),
      chunks: bucket.chunks
    }));
}

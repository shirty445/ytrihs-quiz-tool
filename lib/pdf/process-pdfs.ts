import { extractPdfWithRetry } from "@/lib/pdf/extract";
import type {
  FileProcessingStatus,
  PromptDensity,
  ProcessedBatchResult,
  ProcessingProgress,
  ProcessingStage,
  ResponseFormat,
  SourceChunk
} from "@/lib/types";
import { chunkText } from "@/lib/text/chunking";
import {
  compressChunkText,
  computeInformationScore,
  estimateTokens,
  fingerprintText
} from "@/lib/text/compression";

interface ProcessingLimits {
  maxFiles: number;
  maxFileSizeBytes: number;
  maxChunksPerFile: number;
  maxTotalChunks: number;
  maxPromptChars: number;
  warningThresholdChars: number;
  extractionRetries: number;
}

/**
 * Chunk and character caps default to unlimited: the prompt planner already
 * enforces a per-batch character budget, and dropping chunks here would defeat
 * coverage-first generation. They stay configurable as an escape hatch for
 * callers that genuinely need to cap browser work.
 */
const DEFAULT_LIMITS: ProcessingLimits = {
  maxFiles: 60,
  maxFileSizeBytes: 30 * 1024 * 1024,
  maxChunksPerFile: Number.POSITIVE_INFINITY,
  maxTotalChunks: Number.POSITIVE_INFINITY,
  maxPromptChars: Number.POSITIVE_INFINITY,
  warningThresholdChars: 220,
  extractionRetries: 2
};

/**
 * Budget for the lossy summary used by the copy/paste flow.
 *
 * Chunks target 1200 chars, so the old 420-char default discarded roughly two
 * thirds of every chunk before the model ever saw it. The full-detail path
 * (local AI) ships `rawText` and skips this entirely.
 */
const COMPRESSED_CHUNK_CHARS = 900;

interface ProcessPdfBatchOptions {
  limits?: Partial<ProcessingLimits>;
  signal?: AbortSignal;
  topicFocus?: string;
  ocrEnabled?: boolean;
  targetQuestionCount?: number;
  questionsPerPrompt?: number;
  promptDensity?: PromptDensity;
  responseFormat?: ResponseFormat;
  onProgress?: (progress: ProcessingProgress) => void;
}

function cloneStatuses(statuses: FileProcessingStatus[]): FileProcessingStatus[] {
  return statuses.map((status) => ({ ...status, warnings: [...status.warnings] }));
}

function createInitialStatuses(files: File[]): FileProcessingStatus[] {
  return files.map((file) => ({
    fileName: file.name,
    fileSize: file.size,
    state: "queued",
    message: "Queued",
    pages: 0,
    chunks: 0,
    warnings: []
  }));
}

function isSupportedSourceFile(file: File): boolean {
  if (file.type.toLowerCase() === "application/pdf") {
    return true;
  }

  if (
    file.type.toLowerCase() ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return true;
  }

  if (file.type.toLowerCase().startsWith("image/")) {
    return true;
  }

  return /\.(pdf|docx|png|jpe?g|webp|gif|bmp|tiff?)$/i.test(file.name);
}

function sanitizeForId(fileName: string): string {
  return fileName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error("PDF processing cancelled by user.");
  }
}

function emitProgress(
  onProgress: ProcessPdfBatchOptions["onProgress"],
  stage: ProcessingStage,
  statuses: FileProcessingStatus[],
  processedFiles: number,
  totalFiles: number,
  processedBytes: number,
  totalBytes: number,
  currentFile?: string
): void {
  onProgress?.({
    stage,
    processedFiles,
    totalFiles,
    processedBytes,
    totalBytes,
    currentFile,
    statusSnapshot: cloneStatuses(statuses)
  });
}

function resolveProcessingLimits(options: ProcessPdfBatchOptions): ProcessingLimits {
  return { ...DEFAULT_LIMITS, ...(options.limits ?? {}) };
}

function dedupeChunks(chunks: SourceChunk[]): SourceChunk[] {
  const map = new Map<string, SourceChunk>();

  for (const chunk of chunks) {
    const key = fingerprintText(chunk.rawText);
    if (!key) {
      map.set(chunk.id, chunk);
      continue;
    }

    const existing = map.get(key);
    if (!existing || chunk.score > existing.score) {
      map.set(key, chunk);
    }
  }

  return Array.from(map.values());
}

function scoreTopicRelevance(text: string, topicFocus?: string): number {
  const focus = topicFocus?.trim().toLowerCase();
  if (!focus) {
    return 0;
  }

  const terms = focus
    .split(/[^a-z0-9]+/g)
    .map((term) => term.trim())
    .filter((term) => term.length >= 3);

  if (terms.length === 0) {
    return 0;
  }

  const lowered = text.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (lowered.includes(term)) {
      score += 8;
    }
  }

  return score;
}

function selectPromptSafeChunks(chunks: SourceChunk[], limits: ProcessingLimits): SourceChunk[] {
  const byFile = new Map<string, SourceChunk[]>();
  for (const chunk of chunks) {
    const collection = byFile.get(chunk.fileName) ?? [];
    collection.push(chunk);
    byFile.set(chunk.fileName, collection);
  }

  for (const [fileName, fileChunks] of byFile.entries()) {
    byFile.set(
      fileName,
      [...fileChunks].sort((a, b) => b.score - a.score)
    );
  }

  const selected: SourceChunk[] = [];
  const used = new Set<string>();
  let charCount = 0;

  // Coverage-first pass: keep at least one top chunk per file when possible.
  for (const fileChunks of byFile.values()) {
    const candidate = fileChunks[0];
    if (!candidate) {
      continue;
    }
    const candidateChars = candidate.compressedText.length;
    if (selected.length >= limits.maxTotalChunks || charCount + candidateChars > limits.maxPromptChars) {
      continue;
    }

    selected.push(candidate);
    used.add(candidate.id);
    charCount += candidateChars;
  }

  // Quality pass: fill remaining budget with best-scoring chunks.
  const ranked = [...chunks].sort((a, b) => b.score - a.score);
  for (const candidate of ranked) {
    if (used.has(candidate.id)) {
      continue;
    }
    if (selected.length >= limits.maxTotalChunks) {
      break;
    }
    if (charCount + candidate.compressedText.length > limits.maxPromptChars) {
      continue;
    }

    selected.push(candidate);
    used.add(candidate.id);
    charCount += candidate.compressedText.length;
  }

  return selected.sort((a, b) => b.score - a.score);
}

export async function processPdfBatch(
  files: File[],
  options: ProcessPdfBatchOptions = {}
): Promise<ProcessedBatchResult> {
  const limits = resolveProcessingLimits(options);
  const allStatuses = createInitialStatuses(files);
  const warnings: string[] = [];
  const skippedFiles: string[] = [];
  let processedBytes = 0;
  let processedFiles = 0;
  let totalPages = 0;
  let sourceOrderCounter = 0;

  if (files.length === 0) {
    throw new Error("Upload at least one PDF, DOCX, or image before generating a prompt.");
  }

  if (files.length > limits.maxFiles) {
    warnings.push(
      `Received ${files.length} files. Only the first ${limits.maxFiles} files were processed to keep performance stable.`
    );

    for (let i = limits.maxFiles; i < allStatuses.length; i += 1) {
      allStatuses[i].state = "failed";
      allStatuses[i].message = "Skipped because max file limit was reached.";
      skippedFiles.push(allStatuses[i].fileName);
    }
  }

  const filesToProcess = files.slice(0, limits.maxFiles);
  const totalBytes = filesToProcess.reduce((sum, file) => sum + file.size, 0);
  const globalChunks: SourceChunk[] = [];

  emitProgress(
    options.onProgress,
    "uploading",
    allStatuses,
    processedFiles,
    filesToProcess.length,
    processedBytes,
    totalBytes
  );

  for (let index = 0; index < filesToProcess.length; index += 1) {
    throwIfAborted(options.signal);

    const file = filesToProcess[index];
    const status = allStatuses[index];

    if (!isSupportedSourceFile(file)) {
      status.state = "failed";
      status.message = "Unsupported file type (PDF, DOCX, and common image files only).";
      skippedFiles.push(file.name);
      warnings.push(`Skipped "${file.name}" because it is not a supported PDF, DOCX, or image file.`);
      processedBytes += file.size;
      processedFiles += 1;
      emitProgress(
        options.onProgress,
        "extracting",
        allStatuses,
        processedFiles,
        filesToProcess.length,
        processedBytes,
        totalBytes,
        file.name
      );
      continue;
    }

    if (file.size > limits.maxFileSizeBytes) {
      status.state = "failed";
      status.message = `File is too large (>${Math.round(limits.maxFileSizeBytes / (1024 * 1024))} MB).`;
      skippedFiles.push(file.name);
      warnings.push(`Skipped "${file.name}" because it exceeded the per-file size limit.`);
      processedBytes += file.size;
      processedFiles += 1;
      emitProgress(
        options.onProgress,
        "extracting",
        allStatuses,
        processedFiles,
        filesToProcess.length,
        processedBytes,
        totalBytes,
        file.name
      );
      continue;
    }

    status.state = "extracting";
    status.message = options.ocrEnabled ? "Extracting text and OCR..." : "Extracting text...";
    emitProgress(
      options.onProgress,
      "extracting",
      allStatuses,
      processedFiles,
      filesToProcess.length,
      processedBytes,
      totalBytes,
      file.name
    );

    try {
      const extracted = await extractPdfWithRetry(
        file,
        limits.extractionRetries,
        options.signal,
        options.ocrEnabled ?? true
      );
      totalPages += extracted.pages.length;
      status.pages = extracted.pages.length;
      status.warnings.push(...extracted.warnings);

      status.state = "analyzing";
      status.message = "Chunking and compressing...";
      emitProgress(
        options.onProgress,
        "analyzing",
        allStatuses,
        processedFiles,
        filesToProcess.length,
        processedBytes,
        totalBytes,
        file.name
      );

      if (extracted.totalTextLength < limits.warningThresholdChars) {
        const warning = "Very little extractable text found.";
        status.warnings.push(warning);
      }

      const rawChunks: SourceChunk[] = [];
      const fileId = sanitizeForId(extracted.fileName) || `file-${index + 1}`;

      for (const page of extracted.pages) {
        const split = chunkText(page.text);

        split.forEach((chunkTextValue, chunkIndex) => {
          const pageLabel = page.pageNumber === null ? "unknown" : `p${page.pageNumber}`;
          const chunkId = `${fileId}-${pageLabel}-c${chunkIndex + 1}`;
          const compressedText = compressChunkText(chunkTextValue, COMPRESSED_CHUNK_CHARS);
          rawChunks.push({
            id: `${fileId}-${pageLabel}-${chunkIndex + 1}`,
            chunkId,
            fileName: extracted.fileName,
            page: page.pageNumber,
            sourceOrder: sourceOrderCounter,
            rawText: chunkTextValue,
            compressedText,
            score:
              computeInformationScore(chunkTextValue) +
              scoreTopicRelevance(chunkTextValue, options.topicFocus),
            estimatedTokens: estimateTokens(compressedText)
          });
          sourceOrderCounter += 1;
        });
      }

      const deduped = dedupeChunks(rawChunks).sort((a, b) => b.score - a.score);
      const selected = Number.isFinite(limits.maxChunksPerFile)
        ? deduped.slice(0, limits.maxChunksPerFile)
        : deduped;
      if (deduped.length > selected.length) {
        status.warnings.push(
          `Retained the top ${selected.length} of ${deduped.length} chunks for this file to keep the browser responsive.`
        );
      }

      status.chunks = selected.length;
      const ocrMessage =
        extracted.ocrPageCount > 0
          ? ` OCR used on ${extracted.ocrPageCount} page${extracted.ocrPageCount === 1 ? "" : "s"}.`
          : "";

      if (selected.length === 0) {
        status.state = "warning";
        status.message = `No usable chunks extracted from this file.${ocrMessage}`.trim();
        status.warnings.push("No usable chunks were found.");
        skippedFiles.push(file.name);
      } else if (status.warnings.length > 0) {
        status.state = "warning";
        status.message = `Completed with warning (${selected.length} chunks).${ocrMessage}`;
      } else {
        status.state = "completed";
        status.message = `Completed (${selected.length} chunks).${ocrMessage}`;
      }

      globalChunks.push(...selected);
    } catch (error) {
      status.state = "failed";
      status.message = error instanceof Error ? error.message : "Unknown processing error";
      skippedFiles.push(file.name);
      warnings.push(`Failed to process "${file.name}".`);
    } finally {
      processedBytes += file.size;
      processedFiles += 1;

      emitProgress(
        options.onProgress,
        "analyzing",
        allStatuses,
        processedFiles,
        filesToProcess.length,
        processedBytes,
        totalBytes,
        file.name
      );
    }
  }

  const globallyDeduped = dedupeChunks(globalChunks);
  const promptSafeChunks = selectPromptSafeChunks(globallyDeduped, limits);

  if (promptSafeChunks.length === 0) {
    throw new Error("No valid source text could be extracted from the uploaded PDFs, DOCX files, or images.");
  }

  if (globallyDeduped.length > promptSafeChunks.length) {
    warnings.push(
      `Compressed source set from ${globallyDeduped.length} to ${promptSafeChunks.length} chunks to fit the planned prompt set.`
    );
  }

  emitProgress(
    options.onProgress,
    "building_prompt",
    allStatuses,
    processedFiles,
    filesToProcess.length,
    processedBytes,
    totalBytes
  );

  return {
    chunks: promptSafeChunks,
    warnings,
    skippedFiles,
    totalPages,
    totalSourceFiles: filesToProcess.length,
    fileStatuses: allStatuses
  };
}

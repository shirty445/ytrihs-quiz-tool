import { extractPdfWithRetry } from "@/lib/pdf/extract";
import type {
  FileProcessingStatus,
  ProcessedBatchResult,
  ProcessingProgress,
  ProcessingStage,
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

const DEFAULT_LIMITS: ProcessingLimits = {
  maxFiles: 60,
  maxFileSizeBytes: 30 * 1024 * 1024,
  maxChunksPerFile: 18,
  maxTotalChunks: 120,
  maxPromptChars: 52_000,
  warningThresholdChars: 220,
  extractionRetries: 2
};

interface ProcessPdfBatchOptions {
  limits?: Partial<ProcessingLimits>;
  signal?: AbortSignal;
  topicFocus?: string;
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

function extensionIsPdf(file: File): boolean {
  if (file.type.toLowerCase() === "application/pdf") {
    return true;
  }
  return file.name.toLowerCase().endsWith(".pdf");
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
  const limits: ProcessingLimits = { ...DEFAULT_LIMITS, ...(options.limits ?? {}) };
  const allStatuses = createInitialStatuses(files);
  const warnings: string[] = [];
  const skippedFiles: string[] = [];
  let processedBytes = 0;
  let processedFiles = 0;
  let totalPages = 0;

  if (files.length === 0) {
    throw new Error("Upload at least one PDF before generating a prompt.");
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

    if (!extensionIsPdf(file)) {
      status.state = "failed";
      status.message = "Unsupported file type (only PDF is allowed).";
      skippedFiles.push(file.name);
      warnings.push(`Skipped "${file.name}" because it is not a PDF.`);
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
    status.message = "Extracting text...";
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
      const extracted = await extractPdfWithRetry(file, limits.extractionRetries, options.signal);
      totalPages += extracted.pages.length;
      status.pages = extracted.pages.length;

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
          const chunkId = `${fileId}-p${page.pageNumber}-c${chunkIndex + 1}`;
          const compressedText = compressChunkText(chunkTextValue);
          rawChunks.push({
            id: `${fileId}-${page.pageNumber}-${chunkIndex + 1}`,
            chunkId,
            fileName: extracted.fileName,
            page: page.pageNumber,
            rawText: chunkTextValue,
            compressedText,
            score:
              computeInformationScore(chunkTextValue) +
              scoreTopicRelevance(chunkTextValue, options.topicFocus),
            estimatedTokens: estimateTokens(compressedText)
          });
        });
      }

      const deduped = dedupeChunks(rawChunks).sort((a, b) => b.score - a.score);
      const selected = deduped.slice(0, limits.maxChunksPerFile);

      status.chunks = selected.length;

      if (selected.length === 0) {
        status.state = "warning";
        status.message = "No usable chunks extracted from this file.";
        status.warnings.push("No usable chunks were found.");
        skippedFiles.push(file.name);
      } else if (status.warnings.length > 0) {
        status.state = "warning";
        status.message = `Completed with warning (${selected.length} chunks).`;
      } else {
        status.state = "completed";
        status.message = `Completed (${selected.length} chunks).`;
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
    throw new Error("No valid source text could be extracted from uploaded PDFs.");
  }

  if (globallyDeduped.length > promptSafeChunks.length) {
    warnings.push(
      `Compressed source set from ${globallyDeduped.length} to ${promptSafeChunks.length} chunks to keep the prompt reliable.`
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

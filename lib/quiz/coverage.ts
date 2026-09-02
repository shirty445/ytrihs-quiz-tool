import type { QuizPayload, SourceChunk } from "@/lib/types";

export interface FileCoverage {
  fileName: string;
  covered: number;
  total: number;
  uncoveredPages: string[];
}

export interface CoverageReport {
  coveredChunkIds: Set<string>;
  uncoveredChunks: SourceChunk[];
  /** chunkIds a model cited that do not exist in the source packet. */
  unknownChunkIds: string[];
  perFile: FileCoverage[];
  totalChunks: number;
  coveredChunks: number;
  coverageRatio: number;
}

function pageLabel(chunk: SourceChunk): string {
  return chunk.page === null ? "unknown" : `p${chunk.page}`;
}

/**
 * Which source chunks actually produced questions.
 *
 * `unknownChunkIds` doubles as a grounding check: a returned chunkId that is
 * not in the packet means the model invented its citation.
 */
export function computeCoverage(quiz: QuizPayload | null, chunks: SourceChunk[]): CoverageReport {
  const knownChunkIds = new Set(chunks.map((chunk) => chunk.chunkId));
  const coveredChunkIds = new Set<string>();
  const unknownChunkIds = new Set<string>();

  for (const question of quiz?.questions ?? []) {
    const chunkId = question.source.chunkId.trim();
    if (!chunkId) {
      continue;
    }
    if (knownChunkIds.has(chunkId)) {
      coveredChunkIds.add(chunkId);
    } else {
      unknownChunkIds.add(chunkId);
    }
  }

  const uncoveredChunks = chunks.filter((chunk) => !coveredChunkIds.has(chunk.chunkId));

  const byFile = new Map<string, SourceChunk[]>();
  for (const chunk of chunks) {
    const bucket = byFile.get(chunk.fileName) ?? [];
    bucket.push(chunk);
    byFile.set(chunk.fileName, bucket);
  }

  const perFile: FileCoverage[] = [...byFile.entries()]
    .map(([fileName, fileChunks]) => {
      const uncovered = fileChunks.filter((chunk) => !coveredChunkIds.has(chunk.chunkId));
      return {
        fileName,
        covered: fileChunks.length - uncovered.length,
        total: fileChunks.length,
        uncoveredPages: Array.from(new Set(uncovered.map(pageLabel)))
      };
    })
    .sort((a, b) => a.covered / a.total - b.covered / b.total);

  const coveredChunks = coveredChunkIds.size;

  return {
    coveredChunkIds,
    uncoveredChunks,
    unknownChunkIds: [...unknownChunkIds],
    perFile,
    totalChunks: chunks.length,
    coveredChunks,
    coverageRatio: chunks.length === 0 ? 1 : coveredChunks / chunks.length
  };
}

export function summarizeCoverage(report: CoverageReport): string {
  if (report.totalChunks === 0) {
    return "No source chunks to cover.";
  }

  const percent = Math.round(report.coverageRatio * 100);
  const gap =
    report.uncoveredChunks.length > 0
      ? ` ${report.uncoveredChunks.length} chunk${report.uncoveredChunks.length === 1 ? "" : "s"} still have no question.`
      : " Every source chunk produced at least one question.";
  const grounding =
    report.unknownChunkIds.length > 0
      ? ` Warning: ${report.unknownChunkIds.length} question${report.unknownChunkIds.length === 1 ? "" : "s"} cite a chunkId that is not in the source packet.`
      : "";

  return `Covered ${report.coveredChunks} of ${report.totalChunks} chunks (${percent}%).${gap}${grounding}`;
}

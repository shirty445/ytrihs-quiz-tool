"use client";

import { summarizeCoverage, type CoverageReport } from "@/lib/quiz/coverage";

interface CoveragePanelProps {
  report: CoverageReport;
  canFillGaps: boolean;
  isBusy: boolean;
  onFillGaps: () => void;
}

function percent(covered: number, total: number): number {
  return total === 0 ? 100 : Math.round((covered / total) * 100);
}

export function CoveragePanel({ report, canFillGaps, isBusy, onFillGaps }: CoveragePanelProps) {
  if (report.totalChunks === 0) {
    return null;
  }

  return (
    <section className="panel">
      <h2>Source Coverage</h2>
      <p className="muted">{summarizeCoverage(report)}</p>

      <div
        className="progress-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent(report.coveredChunks, report.totalChunks)}
      >
        <div
          className="progress-bar"
          style={{ width: `${percent(report.coveredChunks, report.totalChunks)}%` }}
        />
      </div>

      <div className="coverage-list">
        {report.perFile.map((file) => (
          <article key={file.fileName} className="coverage-row">
            <div className="coverage-head">
              <strong>{file.fileName}</strong>
              <span>
                {file.covered}/{file.total} chunks ({percent(file.covered, file.total)}%)
              </span>
            </div>
            <div className="progress-track">
              <div className="progress-bar" style={{ width: `${percent(file.covered, file.total)}%` }} />
            </div>
            {file.uncoveredPages.length > 0 ? (
              <span className="muted">Uncovered: {file.uncoveredPages.join(", ")}</span>
            ) : null}
          </article>
        ))}
      </div>

      {report.unknownChunkIds.length > 0 ? (
        <div className="error-box">
          <strong>Ungrounded citations:</strong>
          <ul>
            {report.unknownChunkIds.slice(0, 10).map((chunkId) => (
              <li key={chunkId}>
                {chunkId} does not exist in the source packet, so that question may be invented.
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="actions-row">
        <button
          type="button"
          onClick={onFillGaps}
          disabled={isBusy || !canFillGaps || report.uncoveredChunks.length === 0}
        >
          Generate Questions For Uncovered Content ({report.uncoveredChunks.length})
        </button>
      </div>
    </section>
  );
}

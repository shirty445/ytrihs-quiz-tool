"use client";

import { AUDIT_FLAG_LABELS, type AuditFlag, type AuditReport } from "@/lib/quiz/audit";

interface AuditPanelProps {
  report: AuditReport;
  questionCount: number;
  isBusy: boolean;
  canAutoFix: boolean;
  onShowFlagged: () => void;
  onAutoFix: () => void;
}

export function AuditPanel({
  report,
  questionCount,
  isBusy,
  canAutoFix,
  onShowFlagged,
  onAutoFix
}: AuditPanelProps) {
  if (questionCount === 0) {
    return null;
  }

  const activeFlags = (Object.keys(AUDIT_FLAG_LABELS) as AuditFlag[]).filter(
    (flag) => report.counts[flag] > 0
  );

  return (
    <section className="panel">
      <h2>Quality Audit</h2>
      <p className="muted">
        {report.flaggedIndexes.length === 0
          ? `No issues found across ${questionCount} question${questionCount === 1 ? "" : "s"}.`
          : `${report.flaggedIndexes.length} of ${questionCount} question${questionCount === 1 ? "" : "s"} have at least one issue worth reviewing.`}
      </p>

      <div className="batch-stats">
        <span>Flagged: {report.flaggedIndexes.length}</span>
        <span>Longest option is the answer: {Math.round(report.longestAnswerRate * 100)}%</span>
      </div>

      {report.longestAnswerRateIsSuspicious ? (
        <div className="error-box">
          The correct answer is the longest option in {Math.round(report.longestAnswerRate * 100)}% of questions. A
          learner can score well by always picking the longest option. Regenerate or auto-fix the flagged questions.
        </div>
      ) : null}

      {activeFlags.length > 0 ? (
        <ul className="warning-list">
          {activeFlags.map((flag) => (
            <li key={flag}>
              {AUDIT_FLAG_LABELS[flag]}: {report.counts[flag]}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="actions-row">
        <button type="button" className="secondary" onClick={onShowFlagged} disabled={report.flaggedIndexes.length === 0}>
          Review Flagged Questions
        </button>
        <button
          type="button"
          onClick={onAutoFix}
          disabled={isBusy || !canAutoFix || report.flaggedIndexes.length === 0}
        >
          Auto-Fix Flagged Questions
        </button>
      </div>
    </section>
  );
}

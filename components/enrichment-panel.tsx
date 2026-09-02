"use client";

import { useMemo, useState } from "react";
import { buildEnrichmentGroups, needsReview } from "@/lib/ai/run-enrichment";
import { buildReviewPrompt } from "@/lib/prompt/build-review-prompt";
import { applyReviews } from "@/lib/ai/run-enrichment";
import { parseReviewResponse } from "@/lib/quiz/review-parse";
import type { QuizPayload, QuizQuestion, SourceChunk } from "@/lib/types";

interface EnrichmentPanelProps {
  quiz: QuizPayload;
  chunks: SourceChunk[];
  isBusy: boolean;
  canUseAi: boolean;
  progressLabel: string;
  onRunAi: (onlyMissing: boolean) => void;
  onApplyQuestions: (updates: { index: number; question: QuizQuestion }[]) => void;
  onStop: () => void;
}

export function EnrichmentPanel({
  quiz,
  chunks,
  isBusy,
  canUseAi,
  progressLabel,
  onRunAi,
  onApplyQuestions,
  onStop
}: EnrichmentPanelProps) {
  const [manualGroupIndex, setManualGroupIndex] = useState(0);
  const [manualResponse, setManualResponse] = useState("");
  const [manualErrors, setManualErrors] = useState<string[]>([]);
  const [manualMessage, setManualMessage] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const [showManual, setShowManual] = useState(false);

  const enrichedCount = useMemo(
    () => quiz.questions.filter((question) => !needsReview(question)).length,
    [quiz]
  );

  const manualGroups = useMemo(
    () => buildEnrichmentGroups(quiz, chunks, { onlyMissing: true }),
    [quiz, chunks]
  );

  const currentGroup = manualGroups[Math.min(manualGroupIndex, Math.max(manualGroups.length - 1, 0))] ?? null;
  const currentPrompt = currentGroup
    ? buildReviewPrompt({
        items: currentGroup.items,
        optionCount: currentGroup.optionCount,
        batchLabel: `Group ${Math.min(manualGroupIndex + 1, manualGroups.length)} of ${manualGroups.length}`
      })
    : "";

  async function onCopyPrompt() {
    if (!currentPrompt) {
      return;
    }
    try {
      await navigator.clipboard.writeText(currentPrompt);
      setCopyMessage("Enrichment prompt copied.");
    } catch {
      setCopyMessage("Clipboard copy failed.");
    }
    window.setTimeout(() => setCopyMessage(""), 1800);
  }

  function onParseManual() {
    if (!currentGroup) {
      return;
    }

    setManualErrors([]);
    setManualMessage("");

    const parsed = parseReviewResponse(manualResponse, currentGroup.optionCount);
    if (!parsed.success) {
      setManualErrors(parsed.errors);
      return;
    }

    const applied = applyReviews(currentGroup, parsed.reviews);
    if (applied.errors.length > 0) {
      setManualErrors(applied.errors);
      return;
    }

    onApplyQuestions(
      currentGroup.questionIndexes.map((index, position) => ({
        index,
        question: applied.questions[position]
      }))
    );

    setManualResponse("");
    setManualMessage(
      `Applied deep reviews to ${currentGroup.questionIndexes.length} question${currentGroup.questionIndexes.length === 1 ? "" : "s"}.`
    );
    setManualGroupIndex(0);
  }

  return (
    <section className="panel">
      <h2>Deep Answer Reviews</h2>
      <p className="muted">
        A second pass that re-reads the full source text behind each question and writes a per-option breakdown: why
        the right answer is right, why each wrong answer is tempting, the facts worth memorizing, and the trap the
        question sets. This is what a learner sees after getting a question wrong, and it is baked into the exported
        HTML so it works offline.
      </p>

      <div className="batch-stats">
        <span>Questions: {quiz.questions.length}</span>
        <span>With deep reviews: {enrichedCount}</span>
        <span>Still missing: {quiz.questions.length - enrichedCount}</span>
      </div>

      {progressLabel ? <div className="instruction-box">{progressLabel}</div> : null}

      <div className="actions-row">
        <button
          type="button"
          onClick={() => onRunAi(true)}
          disabled={isBusy || !canUseAi || enrichedCount === quiz.questions.length}
        >
          Generate Missing Reviews
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => onRunAi(false)}
          disabled={isBusy || !canUseAi || quiz.questions.length === 0}
        >
          Regenerate All Reviews
        </button>
        {isBusy ? (
          <button type="button" className="secondary" onClick={onStop}>
            Stop
          </button>
        ) : null}
        <button type="button" className="secondary" onClick={() => setShowManual((previous) => !previous)}>
          {showManual ? "Hide Copy/Paste Mode" : "Use Copy/Paste Mode"}
        </button>
      </div>

      {!canUseAi ? (
        <p className="muted">
          Connect a local model above to generate these automatically, or use copy/paste mode with any external AI.
        </p>
      ) : null}

      {showManual ? (
        <>
          <p className="muted">
            {manualGroups.length === 0
              ? "Every question already has a deep review."
              : `Group ${Math.min(manualGroupIndex + 1, manualGroups.length)} of ${manualGroups.length}. Copy this prompt into any AI, then paste the JSON back below. Parsed groups drop off the queue automatically.`}
          </p>

          {currentGroup ? (
            <>
              <div className="actions-row">
                <button type="button" onClick={onCopyPrompt}>
                  Copy Enrichment Prompt
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setManualGroupIndex((previous) => Math.max(0, previous - 1))}
                  disabled={manualGroupIndex === 0}
                >
                  Previous Group
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    setManualGroupIndex((previous) => Math.min(manualGroups.length - 1, previous + 1))
                  }
                  disabled={manualGroupIndex >= manualGroups.length - 1}
                >
                  Next Group
                </button>
                <span className="muted">{copyMessage}</span>
              </div>

              <textarea className="large-textarea" value={currentPrompt} readOnly rows={12} />

              <textarea
                className="large-textarea"
                value={manualResponse}
                onChange={(event) => setManualResponse(event.target.value)}
                placeholder="Paste the enrichment JSON response here..."
                rows={10}
              />

              <div className="actions-row">
                <button type="button" onClick={onParseManual} disabled={manualResponse.trim().length === 0}>
                  Parse Enrichment Response
                </button>
              </div>
            </>
          ) : null}

          {manualMessage ? <div className="instruction-box">{manualMessage}</div> : null}

          {manualErrors.length > 0 ? (
            <div className="error-box">
              <strong>Enrichment validation failed:</strong>
              <ul>
                {manualErrors.map((error, index) => (
                  <li key={`${error}-${index}`}>{error}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

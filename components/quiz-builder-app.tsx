"use client";

import { useMemo, useState, type DragEvent } from "react";
import { FileStatusList } from "@/components/file-status-list";
import { QuizEditor } from "@/components/quiz-editor";
import { StageIndicator } from "@/components/stage-indicator";
import { processPdfBatch } from "@/lib/pdf/process-pdfs";
import {
  normalizeQuestionsPerPrompt,
  PROMPT_DENSITY_PRESETS,
  QUESTIONS_PER_PROMPT_OPTIONS
} from "@/lib/prompt/modes";
import { buildMasterPrompt } from "@/lib/prompt/build-master-prompt";
import { buildPromptBatches } from "@/lib/prompt/plan";
import { quizToCsv, quizToJson } from "@/lib/quiz/export";
import { quizToHtml } from "@/lib/quiz/html";
import { mergeQuizPayload } from "@/lib/quiz/merge";
import { parseQuizResponse } from "@/lib/quiz/parse";
import { rebalanceAnswerPositions } from "@/lib/quiz/quality";
import type {
  Difficulty,
  FileProcessingStatus,
  ProcessedBatchResult,
  ProcessingStage,
  PromptBatch,
  PromptBatchState,
  PromptDensity,
  QuizPayload,
  QuizSettings,
  ResponseFormat
} from "@/lib/types";

const QUESTION_COUNT_OPTIONS = [5, 10, 25, 50, 100, 200, 300];

const DEFAULT_SETTINGS: QuizSettings = {
  difficulty: "medium",
  topicFocus: "",
  targetQuestionCount: 25,
  promptDensity: "standard",
  questionsPerPrompt: PROMPT_DENSITY_PRESETS.standard.questionsPerPrompt,
  responseFormat: "standard"
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function queuedStatus(files: File[]): FileProcessingStatus[] {
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

function downloadFile(fileName: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function copyToClipboard(value: string): Promise<void> {
  return navigator.clipboard.writeText(value);
}

function buildHtmlFileName(questionCount: number): string {
  return `interactive-quiz-${questionCount}-questions.html`;
}

function stageSummaryLabel(stage: ProcessingStage): string {
  switch (stage) {
    case "idle":
      return "Ready";
    case "uploading":
      return "Uploading files";
    case "extracting":
      return "Extracting PDF text";
    case "analyzing":
      return "Analyzing and compressing chunks";
    case "building_prompt":
      return "Building prompt queue";
    case "waiting_for_ai":
      return "Waiting for pasted AI batch output";
    case "parsed_success":
      return "Quiz parsed successfully";
    case "failed":
      return "Failed";
    default:
      return "Working";
  }
}

function createPromptBatchState(batches: PromptBatch[]): PromptBatchState[] {
  return batches.map((batch) => ({
    ...batch,
    response: "",
    status: "pending",
    addedQuestionCount: 0,
    duplicateQuestionCount: 0,
    qualityNotes: []
  }));
}

function nextPendingBatchIndex(batches: PromptBatchState[]): number {
  return batches.findIndex((batch) => batch.status === "pending");
}

function buildSampleResponse(questionCount: number, responseFormat: ResponseFormat): string {
  if (responseFormat === "compact") {
    return JSON.stringify(
      {
        questions: Array.from({ length: questionCount }, (_, index) => [
          `Sample question ${index + 1}?`,
          [
            `Sample option A${index + 1}`,
            `Sample option B${index + 1}`,
            `Sample option C${index + 1}`,
            `Sample option D${index + 1}`
          ],
          0,
          `Sample explanation ${index + 1}.`,
          ["Sample.pdf", String(index + 1), `sample-chunk-${index + 1}`]
        ])
      },
      null,
      2
    );
  }

  return JSON.stringify(
    {
      questions: Array.from({ length: questionCount }, (_, index) => ({
        question: `Sample question ${index + 1}?`,
        options: [
          `Sample option A${index + 1}`,
          `Sample option B${index + 1}`,
          `Sample option C${index + 1}`,
          `Sample option D${index + 1}`
        ],
        correctAnswer: `Sample option A${index + 1}`,
        explanation: `Sample explanation ${index + 1}.`,
        source: {
          file: "Sample.pdf",
          page: String(index + 1),
          chunkId: `sample-chunk-${index + 1}`
        }
      }))
    },
    null,
    2
  );
}

export function QuizBuilderApp() {
  const [files, setFiles] = useState<File[]>([]);
  const [statuses, setStatuses] = useState<FileProcessingStatus[]>([]);
  const [stage, setStage] = useState<ProcessingStage>("idle");
  const [settings, setSettings] = useState<QuizSettings>(DEFAULT_SETTINGS);
  const [progressPercent, setProgressPercent] = useState(0);
  const [isBusy, setIsBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<ProcessedBatchResult | null>(null);
  const [promptBatches, setPromptBatches] = useState<PromptBatchState[]>([]);
  const [currentBatchIndex, setCurrentBatchIndex] = useState(0);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [quiz, setQuiz] = useState<QuizPayload | null>(null);
  const [copyMessage, setCopyMessage] = useState("");
  const [batchMessage, setBatchMessage] = useState<string | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);

  const totalBytes = useMemo(() => files.reduce((sum, file) => sum + file.size, 0), [files]);
  const plannedQuestionCount = useMemo(
    () => promptBatches.reduce((sum, batch) => sum + batch.questionCount, 0),
    [promptBatches]
  );
  const parsedBatchCount = useMemo(
    () => promptBatches.filter((batch) => batch.status === "parsed").length,
    [promptBatches]
  );
  const currentBatch = promptBatches[currentBatchIndex] ?? null;
  const currentPrompt = currentBatch
    ? buildMasterPrompt({
        chunks: currentBatch.chunks,
        difficulty: settings.difficulty,
        topicFocus: settings.topicFocus,
        questionCount: currentBatch.questionCount,
        batchLabel: `Prompt ${currentBatch.batchNumber} of ${promptBatches.length}`,
        previousQuestions: (quiz?.questions ?? []).map((question) => question.question).slice(-25),
        responseFormat: settings.responseFormat
      })
    : "";

  function resetPromptWorkflow(): void {
    setPromptBatches([]);
    setCurrentBatchIndex(0);
    setValidationErrors([]);
    setQuiz(null);
    setBatchMessage(null);
    setCopyMessage("");
  }

  function mergeFiles(newFiles: File[]) {
    const merged = [...files];
    const seen = new Set(merged.map((file) => `${file.name}-${file.size}-${file.lastModified}`));

    for (const file of newFiles) {
      const signature = `${file.name}-${file.size}-${file.lastModified}`;
      if (!seen.has(signature)) {
        merged.push(file);
        seen.add(signature);
      }
    }

    setFiles(merged);
    setStatuses(queuedStatus(merged));
    setStage("idle");
    setResult(null);
    resetPromptWorkflow();
    setErrorMessage(null);
  }

  function onPickFiles(fileList: FileList | null) {
    if (!fileList) {
      return;
    }
    mergeFiles(Array.from(fileList));
  }

  function onDropFiles(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setIsDragActive(false);
    onPickFiles(event.dataTransfer.files);
  }

  function buildPromptQueue(processed: ProcessedBatchResult) {
    const batches = buildPromptBatches(
      processed.chunks,
      settings.targetQuestionCount,
      {
        questionsPerPrompt: settings.questionsPerPrompt,
        promptDensity: settings.promptDensity,
        responseFormat: settings.responseFormat
      }
    );
    const nextBatches = createPromptBatchState(batches);
    const requestedPromptCount = Math.max(
      1,
      Math.ceil(settings.targetQuestionCount / normalizeQuestionsPerPrompt(settings.questionsPerPrompt))
    );
    const sourceSafetyNote =
      nextBatches.length > requestedPromptCount
        ? ` Source volume required ${nextBatches.length - requestedPromptCount} extra prompt${nextBatches.length - requestedPromptCount === 1 ? "" : "s"} to keep each batch usable.`
        : "";
    setPromptBatches(nextBatches);
    setCurrentBatchIndex(0);
    setBatchMessage(
      `Prepared ${nextBatches.length} prompt${nextBatches.length === 1 ? "" : "s"} for ${nextBatches.reduce((sum, batch) => sum + batch.questionCount, 0)} planned questions at ${settings.questionsPerPrompt} per prompt in ${PROMPT_DENSITY_PRESETS[settings.promptDensity].label} mode using ${settings.responseFormat === "compact" ? "compact" : "standard"} JSON.${sourceSafetyNote}`
    );
  }

  async function buildPromptFromFiles() {
    if (files.length === 0) {
      setErrorMessage("Upload at least one PDF before generating prompts.");
      return;
    }

    setIsBusy(true);
    setErrorMessage(null);
    setValidationErrors([]);
    resetPromptWorkflow();
    setStage("uploading");
    setProgressPercent(0);

    try {
      const processed = await processPdfBatch(files, {
        topicFocus: settings.topicFocus,
        onProgress: (progress) => {
          setStage(progress.stage);
          setStatuses(progress.statusSnapshot);
          const percent =
            progress.totalBytes > 0
              ? Math.max(1, Math.round((progress.processedBytes / progress.totalBytes) * 100))
              : 0;
          setProgressPercent(percent);
        }
      });

      setStage("building_prompt");
      setResult(processed);
      buildPromptQueue(processed);
      setStage("waiting_for_ai");
      setProgressPercent(100);
    } catch (error) {
      setStage("failed");
      setErrorMessage(error instanceof Error ? error.message : "Unexpected processing error");
    } finally {
      setIsBusy(false);
    }
  }

  function regeneratePromptFromExistingSources() {
    if (!result) {
      return;
    }

    setErrorMessage(null);
    setValidationErrors([]);
    setStage("building_prompt");
    resetPromptWorkflow();
    buildPromptQueue(result);
    setStage("waiting_for_ai");
  }

  function updateCurrentBatchResponse(value: string) {
    setPromptBatches((previous) =>
      previous.map((batch, index) => (index === currentBatchIndex ? { ...batch, response: value } : batch))
    );
  }

  function parseCurrentBatch() {
    if (!currentBatch) {
      return;
    }

    setValidationErrors([]);
    setErrorMessage(null);

    const parsed = parseQuizResponse(currentBatch.response, settings.responseFormat);
    if (!parsed.success || !parsed.data) {
      setStage("failed");
      setValidationErrors(parsed.errors);
      return;
    }

    const parsedQuestionCount = parsed.data.questions.length;
    const rebalanced = rebalanceAnswerPositions(parsed.data, quiz?.questions.length ?? 0);
    const mergeResult = mergeQuizPayload(quiz, rebalanced.quiz);
    const qualityNotes: string[] = [];
    const countDifference = parsedQuestionCount - currentBatch.questionCount;

    if (countDifference !== 0) {
      qualityNotes.push(
        countDifference > 0
          ? `Accepted ${parsedQuestionCount} questions for a target of ${currentBatch.questionCount} (${countDifference} over target).`
          : `Accepted ${parsedQuestionCount} questions for a target of ${currentBatch.questionCount} (${Math.abs(countDifference)} under target).`
      );
    }

    if (rebalanced.report.skewDetected) {
      qualityNotes.push("Detected answer-position skew and redistributed correct options across A-D.");
    }

    if (rebalanced.report.duplicateOptionQuestionCount > 0) {
      qualityNotes.push(
        `Detected ${rebalanced.report.duplicateOptionQuestionCount} question${rebalanced.report.duplicateOptionQuestionCount === 1 ? "" : "s"} with duplicate option text. Review before export.`
      );
    }

    const updatedBatches = promptBatches.map((batch, index) =>
      index === currentBatchIndex
        ? {
            ...batch,
            status: "parsed" as const,
            addedQuestionCount: mergeResult.addedCount,
            duplicateQuestionCount: mergeResult.duplicateCount,
            qualityNotes
          }
        : batch
    );

    setQuiz(mergeResult.quiz);
    setPromptBatches(updatedBatches);
    setValidationErrors([]);
    setBatchMessage(
      `Prompt ${currentBatch.batchNumber} accepted ${parsedQuestionCount} question${parsedQuestionCount === 1 ? "" : "s"} for a target of ${currentBatch.questionCount} and added ${mergeResult.addedCount} question${mergeResult.addedCount === 1 ? "" : "s"}${mergeResult.duplicateCount > 0 ? ` while skipping ${mergeResult.duplicateCount} duplicate${mergeResult.duplicateCount === 1 ? "" : "s"}` : ""}.${qualityNotes.length > 0 ? ` ${qualityNotes.join(" ")}` : ""}`
    );

    const nextIndex = nextPendingBatchIndex(updatedBatches);
    if (nextIndex >= 0) {
      setCurrentBatchIndex(nextIndex);
      setStage("waiting_for_ai");
      return;
    }

    setStage("parsed_success");
  }

  function onDifficultyChange(value: string) {
    setSettings((previous) => ({
      ...previous,
      difficulty: value as Difficulty
    }));
  }

  function onDensityChange(value: string) {
    const density = value as PromptDensity;
    setSettings((previous) => ({
      ...previous,
      promptDensity: density,
      questionsPerPrompt: PROMPT_DENSITY_PRESETS[density].questionsPerPrompt
    }));
  }

  async function onCopyPrompt() {
    if (!currentPrompt) {
      return;
    }

    try {
      await copyToClipboard(currentPrompt);
      setCopyMessage("Prompt copied.");
      window.setTimeout(() => setCopyMessage(""), 1800);
    } catch {
      setCopyMessage("Clipboard copy failed.");
      window.setTimeout(() => setCopyMessage(""), 2000);
    }
  }

  return (
    <main className="page">
      <section className="hero">
        <h1>shirty's quiz tool</h1>
        <p className="hero-subtitle">
          Turn PDFs into a prompt queue, auto-balance answer positions after parsing, and keep denser prompt features
          modular enough to remove later if needed.
        </p>
      </section>

      <section className="panel">
        <h2>1) Upload PDFs</h2>
        <p className="muted">
          Supports large batches. Each PDF is handled independently so one failure does not knock out the full run.
        </p>

        <div className="actions-row">
          <label
            className={`dropzone${isDragActive ? " is-drag-active" : ""}`}
            onDragEnter={(event) => {
              event.preventDefault();
              setIsDragActive(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragActive(true);
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              if (event.currentTarget === event.target) {
                setIsDragActive(false);
              }
            }}
            onDrop={onDropFiles}
          >
            <input
              type="file"
              accept="application/pdf,.pdf"
              multiple
              onChange={(event) => {
                onPickFiles(event.target.files);
                event.target.value = "";
              }}
            />
            <strong>Drop PDFs here</strong>
            <span>or click to browse</span>
          </label>

          <button
            type="button"
            className="secondary"
            onClick={() => {
              setFiles([]);
              setStatuses([]);
              setResult(null);
              resetPromptWorkflow();
              setErrorMessage(null);
              setStage("idle");
              setProgressPercent(0);
            }}
            disabled={isBusy || files.length === 0}
          >
            Clear All
          </button>
        </div>

        <p className="muted">
          Files: {files.length} | Total size: {formatBytes(totalBytes)}
        </p>

        <div className="file-chip-wrap">
          {files.map((file) => (
            <span key={`${file.name}-${file.lastModified}`} className="file-chip">
              {file.name} ({formatBytes(file.size)})
            </span>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>2) Quiz Settings</h2>
        <p className="muted">
          Prompt density and compact response mode are isolated settings so they can be removed later without rewriting
          the core quiz pipeline.
        </p>
        <div className="settings-grid">
          <label className="field">
            <span>Difficulty</span>
            <select value={settings.difficulty} onChange={(event) => onDifficultyChange(event.target.value)}>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
              <option value="mixed">Mixed</option>
            </select>
          </label>

          <label className="field">
            <span>Target Question Count</span>
            <select
              value={settings.targetQuestionCount}
              onChange={(event) =>
                setSettings((previous) => ({
                  ...previous,
                  targetQuestionCount: Number(event.target.value)
                }))
              }
            >
              {QUESTION_COUNT_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Prompt Mode</span>
            <select value={settings.promptDensity} onChange={(event) => onDensityChange(event.target.value)}>
              {Object.entries(PROMPT_DENSITY_PRESETS).map(([key, preset]) => (
                <option key={key} value={key}>
                  {preset.label}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Questions Per Prompt</span>
            <select
              value={settings.questionsPerPrompt}
              onChange={(event) =>
                setSettings((previous) => ({
                  ...previous,
                  questionsPerPrompt: Number(event.target.value)
                }))
              }
            >
              {QUESTIONS_PER_PROMPT_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Response Format</span>
            <select
              value={settings.responseFormat}
              onChange={(event) =>
                setSettings((previous) => ({
                  ...previous,
                  responseFormat: event.target.value as ResponseFormat
                }))
              }
            >
              <option value="standard">Standard JSON</option>
              <option value="compact">Compact JSON</option>
            </select>
          </label>

          <label className="field">
            <span>Topic Focus (Optional)</span>
            <input
              type="text"
              placeholder="Example: Chapter 4 definitions"
              value={settings.topicFocus}
              onChange={(event) =>
                setSettings((previous) => ({
                  ...previous,
                  topicFocus: event.target.value
                }))
              }
            />
          </label>
        </div>

        <p className="muted">
          {PROMPT_DENSITY_PRESETS[settings.promptDensity].description} Current response format:{" "}
          {settings.responseFormat === "compact" ? "compact experimental mode" : "standard verbose mode"}.
        </p>

        <div className="actions-row">
          <button type="button" onClick={buildPromptFromFiles} disabled={isBusy || files.length === 0}>
            {isBusy ? "Processing..." : "Generate Prompt Queue"}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={regeneratePromptFromExistingSources}
            disabled={!result || isBusy}
          >
            Rebuild Queue (Same PDFs)
          </button>
        </div>
      </section>

      <section className="panel">
        <h2>3) Processing Status</h2>
        <StageIndicator stage={stage} />
        <p className="status-line">{stageSummaryLabel(stage)}</p>
        <div
          className="progress-track"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progressPercent}
        >
          <div className="progress-bar" style={{ width: `${progressPercent}%` }} />
        </div>
        <FileStatusList statuses={statuses} />
      </section>

      {result ? (
        <section className="panel">
          <h2>4) Source Packet Summary</h2>
          <p className="muted">
            Source files processed: {result.totalSourceFiles} | Pages with text: {result.totalPages} | Prompt chunks:{" "}
            {result.chunks.length}
          </p>

          {result.warnings.length > 0 ? (
            <ul className="warning-list">
              {result.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : null}

          {result.skippedFiles.length > 0 ? (
            <p className="muted">Skipped files: {result.skippedFiles.join(", ")}</p>
          ) : null}
        </section>
      ) : null}

      <section className="panel">
        <h2>5) Prompt Queue</h2>
        <div className="instruction-box">
          <strong>How to use this queue:</strong>
          <ol>
            <li>Copy the current prompt.</li>
            <li>Paste it into your preferred AI model.</li>
            <li>Copy the AI&apos;s JSON for that batch only.</li>
            <li>Paste it back into the current batch response box.</li>
            <li>Parse it, then move on to the next prompt.</li>
          </ol>
        </div>

        <div className="batch-stats">
          <span>Prompts: {promptBatches.length}</span>
          <span>Planned questions: {plannedQuestionCount}</span>
          <span>Completed prompts: {parsedBatchCount}</span>
          <span>Collected questions: {quiz?.questions.length ?? 0}</span>
        </div>

        {promptBatches.length > 0 ? (
          <div className="batch-list">
            {promptBatches.map((batch, index) => (
              <article key={batch.id} className={`batch-card${index === currentBatchIndex ? " is-current" : ""}`}>
                <strong>
                  Prompt {batch.batchNumber}{" "}
                  {batch.status === "parsed" ? "(parsed)" : index === currentBatchIndex ? "(current)" : "(queued)"}
                </strong>
                <span>
                  Target {batch.questionCount} questions | {batch.chunkCount} chunks | {batch.sourceFiles.length} files
                </span>
                {batch.status === "parsed" ? (
                  <>
                    <span>
                      Added {batch.addedQuestionCount} | Duplicates skipped {batch.duplicateQuestionCount}
                    </span>
                    {batch.qualityNotes.map((note) => (
                      <span key={note}>{note}</span>
                    ))}
                  </>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <p className="muted">Generate a prompt queue to begin.</p>
        )}

        {currentBatch ? (
          <>
            <p className="muted">
              Current prompt: {currentBatch.batchNumber} of {promptBatches.length}. This batch targets about{" "}
              {currentBatch.questionCount} questions, but valid under or over counts are accepted. Format:{" "}
              {settings.responseFormat === "compact" ? "compact JSON" : "standard JSON"}.
            </p>
            <div className="actions-row">
              <button type="button" onClick={onCopyPrompt} disabled={!currentPrompt}>
                Copy Current Prompt
              </button>
              <span className="muted">{copyMessage}</span>
            </div>

            <textarea
              className="large-textarea"
              value={currentPrompt}
              readOnly
              placeholder="Your current generated prompt will appear here after processing."
              rows={16}
            />
          </>
        ) : (
          <p className="muted">All prompt batches are complete.</p>
        )}
      </section>

      <section className="panel">
        <h2>6) Paste Current Batch Response</h2>
        {currentBatch ? (
          <p className="muted">
            Prompt {currentBatch.batchNumber} targets about {currentBatch.questionCount} questions in{" "}
            {settings.responseFormat === "compact" ? "compact" : "standard"} JSON. Any valid question count is
            accepted.
          </p>
        ) : (
          <p className="muted">No pending prompt remains. You can export the merged quiz below.</p>
        )}

        <textarea
          className="large-textarea"
          value={currentBatch?.response ?? ""}
          onChange={(event) => updateCurrentBatchResponse(event.target.value)}
          placeholder="Paste the current batch JSON response here..."
          rows={16}
          disabled={!currentBatch}
        />

        <div className="actions-row">
          <button
            type="button"
            onClick={parseCurrentBatch}
            disabled={!currentBatch || currentBatch.response.trim().length === 0}
          >
            Parse Current Batch
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() =>
              updateCurrentBatchResponse(
                buildSampleResponse(currentBatch?.questionCount ?? 1, settings.responseFormat)
              )
            }
            disabled={!currentBatch}
          >
            Load Sample JSON
          </button>
        </div>

        {batchMessage ? <div className="instruction-box">{batchMessage}</div> : null}

        {validationErrors.length > 0 ? (
          <div className="error-box">
            <strong>Validation failed:</strong>
            <ul>
              {validationErrors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      {quiz ? (
        <>
          <QuizEditor quiz={quiz} onChange={setQuiz} />

          <section className="panel">
            <h2>7) Export</h2>
            <p className="muted">
              Export the merged question bank as structured data, or generate one standalone `.html` quiz file from the
              accumulated set.
            </p>
            <div className="actions-row">
              <button type="button" onClick={() => downloadFile("quiz.json", quizToJson(quiz), "application/json")}>
                Export JSON
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => downloadFile("quiz.csv", quizToCsv(quiz), "text/csv")}
              >
                Export CSV
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  downloadFile(
                    buildHtmlFileName(quiz.questions.length),
                    quizToHtml(quiz, "made using ytrihs's quiz tool"),
                    "text/html"
                  )
                }
              >
                Export Interactive HTML
              </button>
            </div>
          </section>
        </>
      ) : null}

      {errorMessage ? <div className="error-box">{errorMessage}</div> : null}
    </main>
  );
}

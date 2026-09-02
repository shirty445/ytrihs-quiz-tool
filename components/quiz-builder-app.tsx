"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { AiConnectionPanel } from "@/components/ai-connection-panel";
import { AuditPanel } from "@/components/audit-panel";
import { CoveragePanel } from "@/components/coverage-panel";
import { EnrichmentPanel } from "@/components/enrichment-panel";
import { FileStatusList } from "@/components/file-status-list";
import { QuizEditor } from "@/components/quiz-editor";
import { StageIndicator } from "@/components/stage-indicator";
import { fetchModelList } from "@/lib/ai/client";
import { autofixQuestion } from "@/lib/ai/run-autofix";
import { buildEnrichmentGroups, enrichGroup } from "@/lib/ai/run-enrichment";
import { generateBatch, type BatchOutcome } from "@/lib/ai/run-quiz-generation";
import { processPdfBatch } from "@/lib/pdf/process-pdfs";
import { buildMasterPrompt } from "@/lib/prompt/build-master-prompt";
import {
  normalizeQuestionsPerPrompt,
  PROMPT_DENSITY_PRESETS,
  QUESTIONS_PER_PROMPT_OPTIONS
} from "@/lib/prompt/modes";
import { buildPromptBatches, type PromptPlan } from "@/lib/prompt/plan";
import { auditQuiz } from "@/lib/quiz/audit";
import { computeCoverage } from "@/lib/quiz/coverage";
import { quizToCsv, quizToJson } from "@/lib/quiz/export";
import { quizToHtml } from "@/lib/quiz/html";
import { describeIngestOutcome, ingestBatchResponse } from "@/lib/quiz/ingest";
import {
  formatOptionRange,
  normalizeOptionCount,
  OPTION_COUNT_OPTIONS,
  optionLabels
} from "@/lib/quiz/options";
import { clearWorkspace, loadWorkspace, saveWorkspace } from "@/lib/storage/workspace";
import type {
  AiConnectionSettings,
  AiConnectionState,
  AiProviderKind,
  ChunkOrdering,
  CognitiveMix,
  CoverageMode,
  Difficulty,
  FileProcessingStatus,
  OptionCount,
  ProcessedBatchResult,
  ProcessingStage,
  PromptBatch,
  PromptBatchState,
  PromptDensity,
  QuizPayload,
  QuizQuestion,
  QuizSettings,
  ResponseFormat,
  SourceChunk,
  SourceDetail
} from "@/lib/types";

const QUESTION_COUNT_OPTIONS = [5, 10, 25, 50, 100, 200, 300, 500, 1000];
const SUPPORTED_SOURCE_ACCEPT =
  "application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx,image/png,image/jpeg,image/webp,image/gif,image/bmp,image/tiff,.png,.jpg,.jpeg,.webp,.gif,.bmp,.tif,.tiff";

const DEFAULT_SETTINGS: QuizSettings = {
  difficulty: "medium",
  topicFocus: "",
  targetQuestionCount: 25,
  promptDensity: "standard",
  questionsPerPrompt: PROMPT_DENSITY_PRESETS.standard.questionsPerPrompt,
  responseFormat: "standard",
  optionCount: 4,
  questionStyle: "",
  customPromptInstructions: "",
  ocrEnabled: true,
  chunkOrdering: "best_match",
  sourceDetail: "compressed",
  coverageMode: "coverage_first",
  cognitiveMix: "balanced"
};

const DEFAULT_AI_CONNECTION: AiConnectionSettings = {
  baseUrl: "http://localhost:11434",
  model: "",
  apiKey: "",
  temperature: 0.2,
  maxOutputTokens: 8192,
  contextTokens: 16384,
  concurrency: 1,
  structuredOutput: "auto",
  reasoning: "off",
  requestTimeoutMs: 180_000
};

const DEFAULT_AI_STATE: AiConnectionState = {
  status: "unknown",
  kind: null,
  models: [],
  message: ""
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

function chunkOrderingLabel(ordering: ChunkOrdering): string {
  switch (ordering) {
    case "page_order":
      return "page order";
    case "random":
      return "randomized";
    case "best_match":
    default:
      return "best-match order";
  }
}

function stageSummaryLabel(stage: ProcessingStage): string {
  switch (stage) {
    case "idle":
      return "Ready";
    case "uploading":
      return "Uploading files";
    case "extracting":
      return "Extracting file text";
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

function createPromptBatchState(batches: PromptBatch[], settings: QuizSettings): PromptBatchState[] {
  return batches.map((batch) => ({
    ...batch,
    response: "",
    status: "pending",
    addedQuestionCount: 0,
    duplicateQuestionCount: 0,
    qualityNotes: [],
    promptOverride: null,
    difficulty: settings.difficulty,
    topicFocus: settings.topicFocus,
    responseFormat: settings.responseFormat,
    optionCount: settings.optionCount,
    questionStyle: settings.questionStyle,
    customPromptInstructions: settings.customPromptInstructions
  }));
}

function buildPromptText(
  batch: PromptBatchState,
  totalBatchCount: number,
  previousQuestions: string[],
  settings: Pick<QuizSettings, "sourceDetail" | "cognitiveMix">
): string {
  return (
    batch.promptOverride ??
    buildMasterPrompt({
      chunks: batch.chunks,
      difficulty: batch.difficulty,
      topicFocus: batch.topicFocus,
      questionCount: batch.questionCount,
      batchLabel: `Prompt ${batch.batchNumber} of ${totalBatchCount}`,
      previousQuestions,
      responseFormat: batch.responseFormat,
      optionCount: batch.optionCount,
      questionStyle: batch.questionStyle,
      customPromptInstructions: batch.customPromptInstructions,
      sourceDetail: settings.sourceDetail,
      cognitiveMix: settings.cognitiveMix
    })
  );
}

/**
 * Dedupe context for a batch: prior questions drawn from the same chunks or
 * files, which is where repetition actually happens, rather than simply the
 * most recent ones.
 */
function relevantPreviousQuestions(
  quiz: QuizPayload | null,
  batch: PromptBatchState | null,
  limit = 40
): string[] {
  const questions = quiz?.questions ?? [];
  if (questions.length === 0) {
    return [];
  }
  if (!batch) {
    return questions.map((question) => question.question).slice(-limit);
  }

  const chunkIds = new Set(batch.chunks.map((chunk) => chunk.chunkId));
  const fileNames = new Set(batch.chunks.map((chunk) => chunk.fileName));

  const sameChunk: string[] = [];
  const sameFile: string[] = [];
  const rest: string[] = [];

  for (const question of questions) {
    if (chunkIds.has(question.source.chunkId)) {
      sameChunk.push(question.question);
    } else if (fileNames.has(question.source.file)) {
      sameFile.push(question.question);
    } else {
      rest.push(question.question);
    }
  }

  return [...sameChunk, ...sameFile.slice(-limit), ...rest.slice(-limit)].slice(0, limit);
}

function nextPendingBatchIndex(batches: PromptBatchState[]): number {
  return batches.findIndex((batch) => batch.status === "pending");
}

function buildSampleOptions(optionCount: OptionCount, questionIndex: number): string[] {
  return optionLabels(optionCount).map((label) => `Sample option ${label}${questionIndex + 1}`);
}

function buildSampleResponse(
  questionCount: number,
  responseFormat: ResponseFormat,
  optionCount: OptionCount
): string {
  if (responseFormat === "compact") {
    return JSON.stringify(
      {
        questions: Array.from({ length: questionCount }, (_, index) => [
          `Sample question ${index + 1}?`,
          buildSampleOptions(optionCount, index),
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
      questions: Array.from({ length: questionCount }, (_, index) => {
        const options = buildSampleOptions(optionCount, index);
        return {
          question: `Sample question ${index + 1}?`,
          options,
          correctAnswer: options[0] ?? "",
          explanation: `Sample explanation ${index + 1}.`,
          source: {
            file: "Sample.pdf",
            page: String(index + 1),
            chunkId: `sample-chunk-${index + 1}`
          }
        };
      })
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
  const [connection, setConnection] = useState<AiConnectionSettings>(DEFAULT_AI_CONNECTION);
  const [aiState, setAiState] = useState<AiConnectionState>(DEFAULT_AI_STATE);
  const [aiRunLabel, setAiRunLabel] = useState("");
  const [pendingPlan, setPendingPlan] = useState<{ coverage: PromptPlan; capped: PromptPlan } | null>(null);
  const [isAiRunning, setIsAiRunning] = useState(false);
  const [enrichmentLabel, setEnrichmentLabel] = useState("");
  const [isEnriching, setIsEnriching] = useState(false);
  const [autosaveMessage, setAutosaveMessage] = useState("");
  const [restoredAt, setRestoredAt] = useState("");
  const [editorFlaggedOnly, setEditorFlaggedOnly] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const hydratedRef = useRef(false);

  const totalBytes = useMemo(() => files.reduce((sum, file) => sum + file.size, 0), [files]);
  const plannedQuestionCount = useMemo(
    () => promptBatches.reduce((sum, batch) => sum + batch.questionCount, 0),
    [promptBatches]
  );
  const parsedBatchCount = useMemo(
    () => promptBatches.filter((batch) => batch.status === "parsed").length,
    [promptBatches]
  );
  const pendingBatchCount = useMemo(
    () => promptBatches.filter((batch) => batch.status === "pending").length,
    [promptBatches]
  );
  const currentBatch = promptBatches[currentBatchIndex] ?? null;
  const currentPrompt = currentBatch
    ? buildPromptText(
        currentBatch,
        promptBatches.length,
        relevantPreviousQuestions(quiz, currentBatch),
        settings
      )
    : "";

  const sourceChunks = useMemo<SourceChunk[]>(() => result?.chunks ?? [], [result]);
  const coverageReport = useMemo(() => computeCoverage(quiz, sourceChunks), [quiz, sourceChunks]);
  const auditReport = useMemo(() => auditQuiz(quiz, sourceChunks), [quiz, sourceChunks]);
  const canUseAi = aiState.status === "connected" && connection.model.trim().length > 0;
  const isAnyRunActive = isAiRunning || isEnriching;

  function resetPromptWorkflow(): void {
    setPendingPlan(null);
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

  const planOptions = useCallback(
    () => ({
      questionsPerPrompt: settings.questionsPerPrompt,
      promptDensity: settings.promptDensity,
      responseFormat: settings.responseFormat,
      chunkOrdering: settings.chunkOrdering,
      sourceDetail: settings.sourceDetail,
      coverageMode: settings.coverageMode
    }),
    [settings]
  );

  function describePlan(plan: PromptPlan, coverageMode: CoverageMode): string {
    const coverageNote =
      coverageMode === "coverage_first"
        ? plan.plannedQuestionCount > settings.targetQuestionCount
          ? ` Coverage-first raised the count from ${settings.targetQuestionCount} to ${plan.plannedQuestionCount} so every source chunk gets at least one question.`
          : " Every source chunk is covered."
        : plan.droppedChunkCount > 0
          ? ` ${plan.droppedChunkCount} chunk${plan.droppedChunkCount === 1 ? "" : "s"} will not be used at this target. Full coverage needs about ${plan.fullCoverageQuestionCount} questions.`
          : " Every source chunk is covered.";

    const shortfallNote =
      plan.plannedQuestionCount < settings.targetQuestionCount
        ? ` Your target of ${settings.targetQuestionCount} does not fit: ${plan.batches.length} prompt${plan.batches.length === 1 ? "" : "s"} at ${settings.questionsPerPrompt} questions each caps this run at ${plan.plannedQuestionCount}. Raise Questions Per Prompt, or add more source material, to plan more.`
        : "";

    return `Prepared ${plan.batches.length} prompt${plan.batches.length === 1 ? "" : "s"} for ${plan.plannedQuestionCount} planned questions at ${settings.questionsPerPrompt} per prompt in ${PROMPT_DENSITY_PRESETS[settings.promptDensity].label} mode using ${settings.responseFormat === "compact" ? "compact" : "standard"} JSON with ${settings.optionCount} choices per question, ${chunkOrderingLabel(settings.chunkOrdering)}, and ${settings.sourceDetail === "full" ? "full source text" : "compressed source text"}.${coverageNote}${shortfallNote}`;
  }

  function commitPlan(plan: PromptPlan, coverageMode: CoverageMode, note = ""): void {
    setPromptBatches(createPromptBatchState(plan.batches, settings));
    setCurrentBatchIndex(0);
    setPendingPlan(null);
    setBatchMessage(`${describePlan(plan, coverageMode)}${note}`);
  }

  /**
   * Builds the queue, pausing for a decision when covering the whole source
   * would cost far more than the requested question count.
   *
   * Silently inflating a target of 50 into 267 questions is a big commitment to
   * make on someone's behalf: it is five times the generation time.
   */
  function buildPromptQueue(processed: ProcessedBatchResult): boolean {
    const coveragePlan = buildPromptBatches(processed.chunks, settings.targetQuestionCount, {
      ...planOptions(),
      coverageMode: "coverage_first"
    });
    const cappedPlan = buildPromptBatches(processed.chunks, settings.targetQuestionCount, {
      ...planOptions(),
      coverageMode: "target_first"
    });

    if (
      settings.coverageMode === "coverage_first" &&
      coveragePlan.plannedQuestionCount > cappedPlan.plannedQuestionCount
    ) {
      setPendingPlan({ coverage: coveragePlan, capped: cappedPlan });
      setBatchMessage(null);
      return false;
    }

    commitPlan(
      settings.coverageMode === "coverage_first" ? coveragePlan : cappedPlan,
      settings.coverageMode
    );
    return true;
  }

  /** Builds a queue that targets only the chunks with no question yet. */
  function buildGapFillQueue(): void {
    const uncovered = coverageReport.uncoveredChunks;
    if (uncovered.length === 0) {
      return;
    }

    const plan = buildPromptBatches(uncovered, uncovered.length, {
      ...planOptions(),
      coverageMode: "coverage_first"
    });
    const nextBatches = createPromptBatchState(plan.batches, settings);

    setPromptBatches(nextBatches);
    setCurrentBatchIndex(0);
    setStage("waiting_for_ai");
    setBatchMessage(
      `Built ${plan.batches.length} gap-fill prompt${plan.batches.length === 1 ? "" : "s"} covering the ${uncovered.length} chunk${uncovered.length === 1 ? "" : "s"} that produced no questions.`
    );
  }

  async function buildPromptFromFiles() {
    if (files.length === 0) {
      setErrorMessage("Upload at least one PDF, DOCX, or image before generating prompts.");
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
        ocrEnabled: settings.ocrEnabled,
        targetQuestionCount: settings.targetQuestionCount,
        questionsPerPrompt: settings.questionsPerPrompt,
        promptDensity: settings.promptDensity,
        responseFormat: settings.responseFormat,
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
      const committed = buildPromptQueue(processed);
      setStage(committed ? "waiting_for_ai" : "building_prompt");
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
    const committed = buildPromptQueue(result);
    setStage(committed ? "waiting_for_ai" : "building_prompt");
  }

  function updateCurrentPromptOverride(value: string) {
    setPromptBatches((previous) =>
      previous.map((batch, index) =>
        index === currentBatchIndex ? { ...batch, promptOverride: value } : batch
      )
    );
  }

  function clearCurrentPromptOverride() {
    setPromptBatches((previous) =>
      previous.map((batch, index) =>
        index === currentBatchIndex ? { ...batch, promptOverride: null } : batch
      )
    );
  }

  function updateCurrentBatchResponse(value: string) {
    setPromptBatches((previous) =>
      previous.map((batch, index) => (index === currentBatchIndex ? { ...batch, response: value } : batch))
    );
  }

  /**
   * Applies one parsed batch response to the workspace.
   *
   * Shared by the manual paste button and the local-AI runner so the two paths
   * cannot drift apart. Returns the updated quiz for callers that chain batches.
   */
  const applyBatchResponse = useCallback(
    (
      batchIndex: number,
      rawResponse: string,
      baseQuiz: QuizPayload | null,
      baseBatches: PromptBatchState[]
    ): { quiz: QuizPayload | null; batches: PromptBatchState[]; message: string; errors: string[] } => {
      const batch = baseBatches[batchIndex];
      if (!batch) {
        return { quiz: baseQuiz, batches: baseBatches, message: "", errors: ["Batch no longer exists."] };
      }

      const outcome = ingestBatchResponse({ quiz: baseQuiz, batch, rawResponse });
      if (!outcome.ok) {
        return { quiz: baseQuiz, batches: baseBatches, message: "", errors: outcome.errors };
      }

      const batches = baseBatches.map((entry, index) =>
        index === batchIndex
          ? {
              ...entry,
              response: rawResponse,
              status: "parsed" as const,
              addedQuestionCount: outcome.addedCount,
              duplicateQuestionCount: outcome.duplicateCount,
              qualityNotes: outcome.qualityNotes
            }
          : entry
      );

      return {
        quiz: outcome.quiz,
        batches,
        message: describeIngestOutcome(batch.batchNumber, outcome),
        errors: []
      };
    },
    []
  );

  function parseCurrentBatch() {
    if (!currentBatch) {
      return;
    }

    setValidationErrors([]);
    setErrorMessage(null);

    const applied = applyBatchResponse(currentBatchIndex, currentBatch.response, quiz, promptBatches);
    if (applied.errors.length > 0) {
      setStage("failed");
      setValidationErrors(applied.errors);
      return;
    }

    setQuiz(applied.quiz);
    setPromptBatches(applied.batches);
    setBatchMessage(applied.message);

    const nextIndex = nextPendingBatchIndex(applied.batches);
    if (nextIndex >= 0) {
      setCurrentBatchIndex(nextIndex);
      setStage("waiting_for_ai");
      return;
    }

    setStage("parsed_success");
  }

  function stopRun() {
    abortRef.current?.abort();
    abortRef.current = null;
  }

  async function onTestConnection() {
    setAiState({ ...DEFAULT_AI_STATE, status: "checking", message: "Checking..." });

    try {
      const discovered = await fetchModelList(connection.baseUrl);
      setAiState({
        status: "connected",
        kind: discovered.kind,
        models: discovered.models,
        message: ""
      });
      setConnection((previous) => ({
        ...previous,
        // Adopt the URL discovery actually resolved to, so the field shows the
        // endpoint in use (e.g. a bare host:1234 becomes host:1234/v1).
        baseUrl: discovered.baseUrl || previous.baseUrl,
        model:
          previous.model && discovered.models.includes(previous.model)
            ? previous.model
            : discovered.models[0] ?? previous.model
      }));
      // Local models have the context budget for full source text; the manual
      // copy/paste flow does not, so only flip the default once connected.
      setSettings((previous) =>
        previous.sourceDetail === "compressed" ? { ...previous, sourceDetail: "full" } : previous
      );
    } catch (error) {
      setAiState({
        status: "error",
        kind: null,
        models: [],
        message: error instanceof Error ? error.message : "Connection failed."
      });
    }
  }

  /** Runs every pending batch through the local model. */
  async function runAllPendingBatches() {
    if (!canUseAi || aiState.kind === null) {
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setIsAiRunning(true);
    setErrorMessage(null);
    setValidationErrors([]);
    setStage("waiting_for_ai");

    let workingQuiz = quiz;
    let workingBatches = promptBatches;
    const failures: string[] = [];
    const startedAt = Date.now();

    const pendingIndexes = workingBatches
      .map((batch, index) => (batch.status === "pending" ? index : -1))
      .filter((index) => index >= 0);

    // Streamed deltas arrive per token; writing state that often would thrash
    // React, so progress accumulates in a ref and is flushed on a timer.
    const liveChars = new Map<number, number>();
    const liveThinking = new Map<number, number>();
    let totalReasoningChars = 0;
    let totalContentChars = 0;
    const outcomes = new Map<number, BatchOutcome>();
    let completed = 0;
    let ingestCursor = 0;

    const describeProgress = () => {
      const elapsed = Math.round((Date.now() - startedAt) / 1000);
      const streamed = [...liveChars.values()].reduce((sum, chars) => sum + chars, 0);
      const thinking = [...liveThinking.values()].reduce((sum, chars) => sum + chars, 0);
      const active = liveChars.size;
      const inFlight =
        active > 1
          ? `${active} prompts in flight`
          : `prompt ${(pendingIndexes[Math.min(completed, pendingIndexes.length - 1)] ?? 0) + 1} of ${workingBatches.length}`;
      // Reasoning models think for a long time before writing anything, so say
      // so rather than showing a frozen zero.
      const written =
        streamed === 0 && thinking > 0
          ? `thinking (${thinking.toLocaleString()} characters of reasoning)`
          : `${streamed.toLocaleString()} characters received${thinking > 0 ? ` after ${thinking.toLocaleString()} of reasoning` : ""}`;
      return `Generating: ${inFlight}. ${completed}/${pendingIndexes.length} done, ${written}, ${elapsed}s elapsed.`;
    };

    const ticker = window.setInterval(() => {
      if (!controller.signal.aborted) {
        setAiRunLabel(describeProgress());
      }
    }, 300);

    // Completions can land out of order when running in parallel, but merging
    // must stay deterministic: dedupe and answer-position balancing both depend
    // on the order questions arrive. So ingest strictly in batch order.
    const drain = () => {
      while (ingestCursor < pendingIndexes.length) {
        const index = pendingIndexes[ingestCursor];
        const outcome = outcomes.get(index);
        if (!outcome) {
          return;
        }
        ingestCursor += 1;

        const batch = workingBatches[index];
        if (!outcome.ok) {
          failures.push(`Prompt ${batch.batchNumber}: ${outcome.errors.join(" ")}`);
          workingBatches = workingBatches.map((entry, entryIndex) =>
            entryIndex === index ? { ...entry, qualityNotes: outcome.errors } : entry
          );
          setPromptBatches(workingBatches);
          continue;
        }

        const applied = applyBatchResponse(index, outcome.rawResponse, workingQuiz, workingBatches);
        if (applied.errors.length > 0) {
          failures.push(`Prompt ${batch.batchNumber}: ${applied.errors.join(" ")}`);
          continue;
        }

        workingQuiz = applied.quiz;
        workingBatches = applied.batches;
        setQuiz(workingQuiz);
        setPromptBatches(workingBatches);
        setBatchMessage(applied.message);
      }
    };

    const concurrency = Math.max(1, Math.min(4, Math.round(connection.concurrency)));
    let cursor = 0;

    const worker = async () => {
      for (;;) {
        const position = cursor;
        cursor += 1;
        if (position >= pendingIndexes.length || controller.signal.aborted) {
          return;
        }

        const index = pendingIndexes[position];
        const batch = workingBatches[index];
        if (concurrency === 1) {
          setCurrentBatchIndex(index);
        }
        liveChars.set(index, 0);
        liveThinking.set(index, 0);

        const promptText = buildPromptText(
          batch,
          workingBatches.length,
          relevantPreviousQuestions(workingQuiz, batch),
          settings
        );

        const outcome = await generateBatch(index, batch, promptText, {
          connection,
          kind: aiState.kind as AiProviderKind,
          signal: controller.signal,
          onProgress: ({ chars, reasoningChars }) => {
            liveChars.set(index, chars);
            liveThinking.set(index, reasoningChars);
          }
        });

        totalContentChars += liveChars.get(index) ?? 0;
        totalReasoningChars += liveThinking.get(index) ?? 0;
        liveChars.delete(index);
        liveThinking.delete(index);
        completed += 1;
        outcomes.set(index, outcome);
        drain();
      }
    };

    try {
      await Promise.all(Array.from({ length: concurrency }, () => worker()));
      drain();
    } finally {
      window.clearInterval(ticker);
      const stopped = controller.signal.aborted;
      abortRef.current = null;
      setIsAiRunning(false);

      const elapsed = Math.round((Date.now() - startedAt) / 1000);
      const pending = nextPendingBatchIndex(workingBatches);
      const collected = workingQuiz?.questions.length ?? 0;

      // Extended reasoning is usually wasted effort for structured extraction,
      // and it is the single biggest cause of a run feeling interminable.
      const reasoningNote =
        totalReasoningChars > totalContentChars && totalReasoningChars > 0
          ? ` Most of that time was this model thinking (${totalReasoningChars.toLocaleString()} characters of reasoning vs ${totalContentChars.toLocaleString()} of answer). A model without extended reasoning will be far faster for this.`
          : "";

      setAiRunLabel(
        stopped
          ? `Stopped after ${elapsed}s. ${collected} questions collected so far.`
          : failures.length > 0
            ? `Finished in ${elapsed}s with ${failures.length} failed prompt${failures.length === 1 ? "" : "s"}. ${collected} questions collected.${reasoningNote}`
            : `Done in ${elapsed}s. ${collected} questions collected.${reasoningNote}`
      );

      if (failures.length > 0) {
        setValidationErrors(failures);
      }

      if (pending >= 0) {
        setCurrentBatchIndex(pending);
        setStage("waiting_for_ai");
      } else if (!stopped) {
        setStage("parsed_success");
      }
    }
  }

  async function runEnrichment(onlyMissing: boolean) {
    if (!quiz || !canUseAi || aiState.kind === null) {
      return;
    }

    const groups = buildEnrichmentGroups(quiz, sourceChunks, { onlyMissing });
    if (groups.length === 0) {
      setEnrichmentLabel("Every question already has a deep review.");
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setIsEnriching(true);

    let workingQuestions = [...quiz.questions];
    const failures: string[] = [];
    const startedAt = Date.now();
    let streamedChars = 0;
    let thinkingChars = 0;
    let groupCursor = 0;

    const ticker = window.setInterval(() => {
      if (!controller.signal.aborted) {
        setEnrichmentLabel(
          `Writing deep reviews: group ${Math.min(groupCursor + 1, groups.length)} of ${groups.length}, ${
            streamedChars === 0 && thinkingChars > 0
              ? `thinking (${thinkingChars.toLocaleString()} characters of reasoning)`
              : `${streamedChars.toLocaleString()} characters received`
          }, ${Math.round((Date.now() - startedAt) / 1000)}s elapsed.`
        );
      }
    }, 300);

    try {
      for (let index = 0; index < groups.length; index += 1) {
        if (controller.signal.aborted) {
          break;
        }

        groupCursor = index;

        const outcome = await enrichGroup(groups[index], {
          connection,
          kind: aiState.kind,
          signal: controller.signal,
          batchLabel: `Group ${index + 1} of ${groups.length}`,
          onProgress: ({ chars, reasoningChars }) => {
            streamedChars = chars;
            thinkingChars = reasoningChars;
          }
        });

        if (!outcome.ok) {
          failures.push(outcome.errors.join(" "));
          continue;
        }

        outcome.questionIndexes.forEach((questionIndex, position) => {
          workingQuestions[questionIndex] = outcome.questions[position];
        });
        setQuiz({ questions: [...workingQuestions] });
      }
    } finally {
      window.clearInterval(ticker);
      const stopped = controller.signal.aborted;
      abortRef.current = null;
      setIsEnriching(false);
      const enriched = workingQuestions.filter((question) => question.review).length;
      const elapsed = Math.round((Date.now() - startedAt) / 1000);
      setEnrichmentLabel(
        stopped
          ? `Stopped after ${elapsed}s. ${enriched} of ${workingQuestions.length} questions have deep reviews.`
          : failures.length > 0
            ? `Finished in ${elapsed}s with ${failures.length} failed group${failures.length === 1 ? "" : "s"}. ${enriched} of ${workingQuestions.length} questions have deep reviews.`
            : `Done in ${elapsed}s. All ${enriched} questions have deep reviews.`
      );
    }
  }

  async function runAutoFix() {
    if (!quiz || !canUseAi || aiState.kind === null) {
      return;
    }

    const flagged = auditReport.questions.filter((audit) => audit.flags.length > 0);
    if (flagged.length === 0) {
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setIsAiRunning(true);

    const workingQuestions = [...quiz.questions];
    let fixedCount = 0;

    try {
      for (let position = 0; position < flagged.length; position += 1) {
        if (controller.signal.aborted) {
          break;
        }

        const audit = flagged[position];
        setAiRunLabel(`Rewriting flagged question ${position + 1} of ${flagged.length}...`);

        const outcome = await autofixQuestion(
          audit.index,
          workingQuestions[audit.index],
          audit,
          sourceChunks,
          { connection, kind: aiState.kind, signal: controller.signal }
        );

        if (outcome.ok) {
          workingQuestions[audit.index] = outcome.question;
          fixedCount += 1;
          setQuiz({ questions: [...workingQuestions] });
        }
      }
    } finally {
      abortRef.current = null;
      setIsAiRunning(false);
      setAiRunLabel(
        `Rewrote ${fixedCount} of ${flagged.length} flagged question${flagged.length === 1 ? "" : "s"}. Re-run the enrichment pass for any rewritten question.`
      );
    }
  }

  // Restore a previous session once on mount. Uploaded File objects cannot be
  // persisted, but the chunks they produced can, so a refresh mid-run does not
  // cost a re-extract.
  useEffect(() => {
    if (hydratedRef.current) {
      return;
    }
    hydratedRef.current = true;

    const saved = loadWorkspace();
    if (!saved) {
      return;
    }

    setSettings(saved.settings);
    setConnection(saved.connection);
    setPromptBatches(saved.promptBatches);
    setQuiz(saved.quiz);

    if (saved.chunks.length > 0) {
      setResult({
        chunks: saved.chunks,
        warnings: [],
        skippedFiles: [],
        totalPages: 0,
        totalSourceFiles: new Set(saved.chunks.map((chunk) => chunk.fileName)).size,
        fileStatuses: []
      });
    }

    if (saved.promptBatches.length > 0) {
      const pending = nextPendingBatchIndex(saved.promptBatches);
      setCurrentBatchIndex(pending >= 0 ? pending : 0);
      setStage(pending >= 0 ? "waiting_for_ai" : "parsed_success");
    }

    setRestoredAt(saved.savedAt);
  }, []);

  useEffect(() => {
    if (!hydratedRef.current) {
      return;
    }

    const handle = window.setTimeout(() => {
      const saved = saveWorkspace({
        settings,
        connection,
        chunks: sourceChunks,
        promptBatches,
        quiz
      });
      setAutosaveMessage(saved.message);
    }, 600);

    return () => window.clearTimeout(handle);
  }, [settings, connection, sourceChunks, promptBatches, quiz]);

  function applyReviewUpdates(updates: { index: number; question: QuizQuestion }[]) {
    if (!quiz) {
      return;
    }
    const questions = [...quiz.questions];
    for (const update of updates) {
      questions[update.index] = update.question;
    }
    setQuiz({ questions });
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

  function onOptionCountChange(value: string) {
    setSettings((previous) => ({
      ...previous,
      optionCount: normalizeOptionCount(Number(value))
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
          Turn PDFs, DOCX files, or images into a prompt queue, OCR text from embedded scans when needed, and keep the
          quiz flow editable from source packet to export.
        </p>
      </section>

      {restoredAt ? (
        <div className="instruction-box">
          Restored your previous workspace{restoredAt ? ` from ${new Date(restoredAt).toLocaleString()}` : ""}.
          Uploaded files are not saved, but the extracted source chunks, prompt queue, and collected questions are.{" "}
          <button
            type="button"
            className="secondary"
            onClick={() => {
              clearWorkspace();
              setRestoredAt("");
              setQuiz(null);
              setResult(null);
              resetPromptWorkflow();
              setStage("idle");
            }}
          >
            Discard Restored Workspace
          </button>
        </div>
      ) : null}

      {autosaveMessage ? <div className="error-box">{autosaveMessage}</div> : null}

      <section className="panel">
        <h2>1) Upload PDFs, DOCX Files, Or Images</h2>
        <p className="muted">
          Supports large batches. Each file is handled independently, and OCR can read text from images embedded in
          PDFs or DOCX files when standard extraction falls short.
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
              accept={SUPPORTED_SOURCE_ACCEPT}
              multiple
              onChange={(event) => {
                onPickFiles(event.target.files);
                event.target.value = "";
              }}
            />
            <strong>Drop PDFs, DOCX files, or images here</strong>
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
          Tune the quiz shape, add extra prompt instructions, and rebuild the queue whenever you want a different
          prompt strategy.
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
            <span>Answer Choices Per Question</span>
            <select value={settings.optionCount} onChange={(event) => onOptionCountChange(event.target.value)}>
              {OPTION_COUNT_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>OCR For Images And Scans</span>
            <select
              value={settings.ocrEnabled ? "on" : "off"}
              onChange={(event) =>
                setSettings((previous) => ({
                  ...previous,
                  ocrEnabled: event.target.value === "on"
                }))
              }
            >
              <option value="on">On</option>
              <option value="off">Off</option>
            </select>
          </label>

          <label className="field">
            <span>Chunk Ordering</span>
            <select
              value={settings.chunkOrdering}
              onChange={(event) =>
                setSettings((previous) => ({
                  ...previous,
                  chunkOrdering: event.target.value as ChunkOrdering
                }))
              }
            >
              <option value="best_match">Best Match</option>
              <option value="page_order">Page Order</option>
              <option value="random">Randomized</option>
            </select>
          </label>

          <label className="field">
            <span>Coverage Mode</span>
            <select
              value={settings.coverageMode}
              onChange={(event) =>
                setSettings((previous) => ({
                  ...previous,
                  coverageMode: event.target.value as CoverageMode
                }))
              }
            >
              <option value="coverage_first">Coverage First (cover everything)</option>
              <option value="target_first">Target First (respect the count)</option>
            </select>
          </label>

          <label className="field">
            <span>Source Detail</span>
            <select
              value={settings.sourceDetail}
              onChange={(event) =>
                setSettings((previous) => ({
                  ...previous,
                  sourceDetail: event.target.value as SourceDetail
                }))
              }
            >
              <option value="full">Full Text (best for local AI)</option>
              <option value="compressed">Compressed (best for copy/paste)</option>
            </select>
          </label>

          <label className="field">
            <span>Question Thinking Level</span>
            <select
              value={settings.cognitiveMix}
              onChange={(event) =>
                setSettings((previous) => ({
                  ...previous,
                  cognitiveMix: event.target.value as CognitiveMix
                }))
              }
            >
              <option value="balanced">Balanced Recall And Application</option>
              <option value="application">Mostly Application And Analysis</option>
              <option value="recall">Mostly Direct Recall</option>
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

          <label className="field">
            <span>Question Style (Optional)</span>
            <input
              type="text"
              placeholder="Example: scenario-based, no trick questions"
              value={settings.questionStyle}
              onChange={(event) =>
                setSettings((previous) => ({
                  ...previous,
                  questionStyle: event.target.value
                }))
              }
            />
          </label>

          <label className="field field-wide">
            <span>Additional Prompt Instructions (Optional)</span>
            <textarea
              placeholder="Example: prioritize definitions first, keep distractors plausible, avoid negative wording, cite chunk evidence directly in explanations."
              value={settings.customPromptInstructions}
              onChange={(event) =>
                setSettings((previous) => ({
                  ...previous,
                  customPromptInstructions: event.target.value
                }))
              }
              rows={5}
            />
          </label>
        </div>

        <p className="muted">
          {PROMPT_DENSITY_PRESETS[settings.promptDensity].description} Current response format:{" "}
          {settings.responseFormat === "compact" ? "compact experimental mode" : "standard verbose mode"} with{" "}
          {settings.optionCount} choices per question and {chunkOrderingLabel(settings.chunkOrdering)}.{" "}
          {settings.coverageMode === "coverage_first"
            ? "Coverage first treats the target count as a floor and raises it if needed so every source chunk produces at least one question."
            : "Target first never exceeds your question count, and reports which source chunks went unused."}{" "}
          {settings.sourceDetail === "full"
            ? "Prompts carry the full chunk text, which needs a large context window."
            : "Prompts carry a compressed summary of each chunk to stay copy/paste friendly."}
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
            Rebuild Queue (Same Files)
          </button>
        </div>
      </section>

      <AiConnectionPanel
        connection={connection}
        state={aiState}
        isBusy={isBusy || isAnyRunActive}
        onChange={setConnection}
        onTestConnection={onTestConnection}
      />

      <section className="panel">
        <h2>4) Processing Status</h2>
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
          <h2>5) Source Packet Summary</h2>
          <p className="muted">
            Source files processed: {result.totalSourceFiles} | Readable pages/items: {result.totalPages} | Prompt
            chunks: {result.chunks.length}
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
        <h2>6) Prompt Queue</h2>
        <div className="instruction-box">
          <strong>How to use this queue:</strong>
          <ol>
            <li>Copy or edit the current prompt.</li>
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

        <div className="actions-row">
          <button
            type="button"
            onClick={runAllPendingBatches}
            disabled={isBusy || isAnyRunActive || !canUseAi || pendingBatchCount === 0}
          >
            {isAiRunning
              ? "Generating..."
              : `Generate All Questions With Local AI (${pendingBatchCount} prompt${pendingBatchCount === 1 ? "" : "s"})`}
          </button>
          {isAnyRunActive ? (
            <button type="button" className="secondary" onClick={stopRun}>
              Stop
            </button>
          ) : null}
          {!canUseAi ? (
            <span className="muted">
              Connect a local model above to run the whole queue automatically, or work through it by hand below.
            </span>
          ) : null}
        </div>

        {aiRunLabel ? <div className="instruction-box">{aiRunLabel}</div> : null}

        {pendingPlan ? (
          <div className="error-box">
            <strong>
              Covering all your source needs {pendingPlan.coverage.plannedQuestionCount} questions, not the{" "}
              {settings.targetQuestionCount} you asked for.
            </strong>
            <p className="muted">
              Your source produced {pendingPlan.coverage.fullCoverageQuestionCount} chunks. Coverage-first mode gives
              every chunk at least one question, so it wants{" "}
              {pendingPlan.coverage.plannedQuestionCount} questions across {pendingPlan.coverage.batches.length}{" "}
              prompts. Capping at your target runs {pendingPlan.capped.batches.length} prompt
              {pendingPlan.capped.batches.length === 1 ? "" : "s"} instead and leaves{" "}
              {pendingPlan.capped.droppedChunkCount} chunk
              {pendingPlan.capped.droppedChunkCount === 1 ? "" : "s"} without a question. Pick whichever you actually
              want — the difference is roughly{" "}
              {Math.max(
                1,
                Math.round(pendingPlan.coverage.batches.length / Math.max(pendingPlan.capped.batches.length, 1))
              )}
              x the generation time.
            </p>
            <div className="actions-row">
              <button
                type="button"
                onClick={() => {
                  commitPlan(pendingPlan.coverage, "coverage_first");
                  setStage("waiting_for_ai");
                }}
              >
                Cover Everything ({pendingPlan.coverage.plannedQuestionCount} questions)
              </button>
              <button
                type="button"
                onClick={() => {
                  setSettings((previous) => ({ ...previous, coverageMode: "target_first" }));
                  commitPlan(
                    pendingPlan.capped,
                    "target_first",
                    " Coverage mode switched to Target First, so this stays your default."
                  );
                  setStage("waiting_for_ai");
                }}
              >
                Cap At {settings.targetQuestionCount}
              </button>
            </div>
          </div>
        ) : null}

        {promptBatches.length > 0 ? (
          <div className="batch-list">
            {promptBatches.map((batch, index) => (
              <article key={batch.id} className={`batch-card${index === currentBatchIndex ? " is-current" : ""}`}>
                <strong>
                  Prompt {batch.batchNumber}{" "}
                  {batch.status === "parsed" ? "(parsed)" : index === currentBatchIndex ? "(current)" : "(queued)"}
                </strong>
                <span>
                  Target {batch.questionCount} questions | {batch.optionCount} choices | {batch.chunkCount} chunks |{" "}
                  {batch.sourceFiles.length} files
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
              {currentBatch.questionCount} questions with {currentBatch.optionCount} choices per question in{" "}
              {currentBatch.responseFormat === "compact" ? "compact JSON" : "standard JSON"}. You can edit this prompt
              before copying it.
            </p>
            <div className="actions-row">
              <button type="button" onClick={onCopyPrompt} disabled={!currentPrompt}>
                Copy Current Prompt
              </button>
              <button
                type="button"
                className="secondary"
                onClick={clearCurrentPromptOverride}
                disabled={!currentBatch.promptOverride}
              >
                Reset Current Prompt
              </button>
              <span className="muted">{copyMessage}</span>
            </div>

            <textarea
              className="large-textarea"
              value={currentPrompt}
              onChange={(event) => updateCurrentPromptOverride(event.target.value)}
              placeholder="Your current generated prompt will appear here after processing."
              rows={16}
            />
          </>
        ) : (
          <p className="muted">All prompt batches are complete.</p>
        )}
      </section>

      <section className="panel">
        <h2>7) Paste Current Batch Response</h2>
        {currentBatch ? (
          <p className="muted">
            Prompt {currentBatch.batchNumber} targets about {currentBatch.questionCount} questions with{" "}
            {currentBatch.optionCount} choices each in{" "}
            {currentBatch.responseFormat === "compact" ? "compact" : "standard"} JSON. Any valid question count is
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
                buildSampleResponse(
                  currentBatch?.questionCount ?? 1,
                  currentBatch?.responseFormat ?? "standard",
                  currentBatch?.optionCount ?? 4
                )
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
          <CoveragePanel
            report={coverageReport}
            canFillGaps={sourceChunks.length > 0}
            isBusy={isBusy || isAnyRunActive}
            onFillGaps={buildGapFillQueue}
          />

          <EnrichmentPanel
            quiz={quiz}
            chunks={sourceChunks}
            isBusy={isEnriching}
            canUseAi={canUseAi}
            progressLabel={enrichmentLabel}
            onRunAi={runEnrichment}
            onApplyQuestions={applyReviewUpdates}
            onStop={stopRun}
          />

          <AuditPanel
            report={auditReport}
            questionCount={quiz.questions.length}
            isBusy={isBusy || isAnyRunActive}
            canAutoFix={canUseAi}
            onShowFlagged={() => setEditorFlaggedOnly(true)}
            onAutoFix={runAutoFix}
          />

          <QuizEditor
            quiz={quiz}
            onChange={setQuiz}
            flaggedIndexes={auditReport.flaggedIndexes}
            flaggedOnly={editorFlaggedOnly}
            onFlaggedOnlyChange={setEditorFlaggedOnly}
          />

          <section className="panel">
            <h2>8) Export</h2>
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

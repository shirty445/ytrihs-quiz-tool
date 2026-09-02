export type ProcessingStage =
  | "idle"
  | "uploading"
  | "extracting"
  | "analyzing"
  | "building_prompt"
  | "waiting_for_ai"
  | "parsed_success"
  | "failed";

export type FileState = "queued" | "extracting" | "analyzing" | "completed" | "warning" | "failed";

export type Difficulty = "easy" | "medium" | "hard" | "mixed";
export type PromptDensity = "light" | "standard" | "dense";
export type ResponseFormat = "standard" | "compact";
export type OptionCount = 4 | 5;
export type ChunkOrdering = "best_match" | "page_order" | "random";
export type SourceDetail = "full" | "compressed";
export type CoverageMode = "coverage_first" | "target_first";
export type CognitiveMix = "recall" | "balanced" | "application";

export interface QuizSettings {
  difficulty: Difficulty;
  topicFocus: string;
  targetQuestionCount: number;
  promptDensity: PromptDensity;
  questionsPerPrompt: number;
  responseFormat: ResponseFormat;
  optionCount: OptionCount;
  questionStyle: string;
  customPromptInstructions: string;
  ocrEnabled: boolean;
  chunkOrdering: ChunkOrdering;
  sourceDetail: SourceDetail;
  coverageMode: CoverageMode;
  cognitiveMix: CognitiveMix;
}

export interface PdfPageText {
  pageNumber: number | null;
  text: string;
}

export interface ExtractedPdf {
  fileName: string;
  fileSize: number;
  pages: PdfPageText[];
  totalTextLength: number;
  warnings: string[];
  ocrPageCount: number;
}

export interface SourceChunk {
  id: string;
  chunkId: string;
  fileName: string;
  page: number | null;
  sourceOrder: number;
  rawText: string;
  compressedText: string;
  score: number;
  estimatedTokens: number;
}

export interface FileProcessingStatus {
  fileName: string;
  fileSize: number;
  state: FileState;
  message: string;
  pages: number;
  chunks: number;
  warnings: string[];
}

export interface ProcessingProgress {
  stage: ProcessingStage;
  processedFiles: number;
  totalFiles: number;
  processedBytes: number;
  totalBytes: number;
  currentFile?: string;
  statusSnapshot: FileProcessingStatus[];
}

export interface SourcePacket {
  chunks: SourceChunk[];
  warnings: string[];
  skippedFiles: string[];
  totalPages: number;
  totalSourceFiles: number;
}

export interface ProcessedBatchResult extends SourcePacket {
  fileStatuses: FileProcessingStatus[];
}

export interface QuestionReview {
  /** The principle the question is actually testing, in 1-2 sentences. */
  coreIdea: string;
  /** Why the correct option is right, grounded in the source text. */
  whyCorrect: string;
  /**
   * Parallel to `options`. Entry i explains why options[i] is right or wrong.
   *
   * Deliberately positional rather than keyed by option text: two options can
   * share text, and `rebalanceAnswerPositions` reorders options, so this array
   * must be permuted alongside `options` (see lib/quiz/quality.ts).
   */
  optionRationales: string[];
  /** Atomic, memorizable facts worth retaining. */
  keyFacts: string[];
  /** A contrast or mnemonic that makes the answer stick. */
  memoryHook: string;
  /** The specific misconception this question sets a trap for. */
  commonConfusion: string;
  /** Verbatim snippet from the source chunk. */
  sourceQuote: string;
}

export interface QuizQuestion {
  question: string;
  options: string[];
  correctAnswer: string;
  explanation: string;
  source: {
    file: string;
    page: string;
    chunkId: string;
  };
  review?: QuestionReview;
}

export interface QuizPayload {
  questions: QuizQuestion[];
}

export interface QuizQualityReport {
  originalCorrectPositionCounts: number[];
  balancedCorrectPositionCounts: number[];
  skewDetected: boolean;
  duplicateOptionQuestionCount: number;
}

export interface PromptBatch {
  id: string;
  batchNumber: number;
  questionCount: number;
  chunkCount: number;
  estimatedChars: number;
  sourceFiles: string[];
  chunks: SourceChunk[];
}

export type PromptBatchStatus = "pending" | "parsed";

export interface PromptBatchState extends PromptBatch {
  response: string;
  status: PromptBatchStatus;
  addedQuestionCount: number;
  duplicateQuestionCount: number;
  qualityNotes: string[];
  promptOverride: string | null;
  difficulty: Difficulty;
  topicFocus: string;
  responseFormat: ResponseFormat;
  optionCount: OptionCount;
  questionStyle: string;
  customPromptInstructions: string;
}

export type AiProviderKind = "ollama" | "openai-compatible";
export type StructuredOutputMode = "auto" | "on" | "off";
/**
 * Whether to let the model "think" before answering. Extended reasoning is
 * near-pure waste for structured extraction: on a warm LM Studio model the
 * identical request took 5.7s and 17.6s with reasoning on versus 0.6s and 0.7s
 * with it off, for the same answer each time.
 */
export type ReasoningMode = "off" | "on";

export interface AiConnectionSettings {
  baseUrl: string;
  model: string;
  apiKey: string;
  temperature: number;
  maxOutputTokens: number;
  contextTokens: number;
  concurrency: number;
  structuredOutput: StructuredOutputMode;
  reasoning: ReasoningMode;
  requestTimeoutMs: number;
}

export interface AiConnectionState {
  status: "unknown" | "checking" | "connected" | "error";
  kind: AiProviderKind | null;
  models: string[];
  message: string;
}

export type AiRunPhase = "idle" | "generating" | "enriching" | "stopped" | "done";

export interface AiRunProgress {
  phase: AiRunPhase;
  completed: number;
  total: number;
  currentLabel: string;
}

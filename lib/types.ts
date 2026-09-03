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

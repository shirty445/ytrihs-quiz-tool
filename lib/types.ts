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

export interface QuizSettings {
  difficulty: Difficulty;
  topicFocus: string;
  targetQuestionCount: number;
  promptDensity: PromptDensity;
  questionsPerPrompt: number;
  responseFormat: ResponseFormat;
}

export interface PdfPageText {
  pageNumber: number;
  text: string;
}

export interface ExtractedPdf {
  fileName: string;
  fileSize: number;
  pages: PdfPageText[];
  totalTextLength: number;
}

export interface SourceChunk {
  id: string;
  chunkId: string;
  fileName: string;
  page: number | null;
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
  options: [string, string, string, string];
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
  originalCorrectPositionCounts: [number, number, number, number];
  balancedCorrectPositionCounts: [number, number, number, number];
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
}

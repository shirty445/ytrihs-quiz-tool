import type {
  AiConnectionSettings,
  PromptBatchState,
  QuizPayload,
  QuizSettings,
  SourceChunk
} from "@/lib/types";

const STORAGE_KEY = "quiz-tool:v1:workspace";
const STORAGE_VERSION = 1;

export interface PersistedWorkspace {
  version: number;
  settings: QuizSettings;
  connection: AiConnectionSettings;
  chunks: SourceChunk[];
  promptBatches: PromptBatchState[];
  quiz: QuizPayload | null;
  savedAt: string;
}

export interface SaveWorkspaceResult {
  ok: boolean;
  message: string;
}

/**
 * Uploaded `File` objects are not serializable and are deliberately not saved.
 * `chunks` is what the rest of the pipeline actually needs, so a reload can
 * resume a long generation run without re-processing the PDFs.
 */
export function saveWorkspace(input: Omit<PersistedWorkspace, "version" | "savedAt">): SaveWorkspaceResult {
  if (typeof window === "undefined") {
    return { ok: false, message: "" };
  }

  const payload: PersistedWorkspace = {
    ...input,
    version: STORAGE_VERSION,
    savedAt: new Date().toISOString()
  };

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    return { ok: true, message: "" };
  } catch {
    // Quota exceeded, or storage blocked. Try again without the source text,
    // which is by far the largest field.
    try {
      const lean: PersistedWorkspace = {
        ...payload,
        chunks: [],
        promptBatches: payload.promptBatches.map((batch) => ({ ...batch, chunks: [] }))
      };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lean));
      return {
        ok: true,
        message: "Workspace is large, so only the quiz and settings were autosaved. Source chunks were dropped."
      };
    } catch {
      return { ok: false, message: "Workspace is too large to autosave in this browser." };
    }
  }
}

export function loadWorkspace(): PersistedWorkspace | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<PersistedWorkspace>;
    if (parsed.version !== STORAGE_VERSION || !parsed.settings || !parsed.connection) {
      return null;
    }

    return {
      version: STORAGE_VERSION,
      settings: parsed.settings,
      connection: parsed.connection,
      chunks: Array.isArray(parsed.chunks) ? parsed.chunks : [],
      promptBatches: Array.isArray(parsed.promptBatches) ? parsed.promptBatches : [],
      quiz: parsed.quiz && Array.isArray(parsed.quiz.questions) ? parsed.quiz : null,
      savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : ""
    };
  } catch {
    return null;
  }
}

export function clearWorkspace(): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

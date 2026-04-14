import type { Difficulty, ResponseFormat, SourceChunk } from "@/lib/types";

interface PromptBuildInput {
  chunks: SourceChunk[];
  difficulty: Difficulty;
  topicFocus: string;
  questionCount?: number;
  batchLabel?: string;
  previousQuestions?: string[];
  responseFormat?: ResponseFormat;
}

function formatDifficulty(difficulty: Difficulty): string {
  switch (difficulty) {
    case "easy":
      return "easy";
    case "medium":
      return "medium";
    case "hard":
      return "hard";
    case "mixed":
      return "mixed levels (1-2 easy, 2-3 medium, up to 1 hard)";
    default:
      return "medium";
  }
}

function sourcePacket(chunks: SourceChunk[]): string {
  return chunks
    .map((chunk, index) => {
      const page = chunk.page ? String(chunk.page) : "unknown";
      return [
        `SOURCE_${index + 1}`,
        `file: ${chunk.fileName}`,
        `page: ${page}`,
        `chunkId: ${chunk.chunkId}`,
        `content: ${chunk.compressedText}`
      ].join("\n");
    })
    .join("\n\n");
}

export function buildMasterPrompt({
  chunks,
  difficulty,
  topicFocus,
  questionCount = 5,
  batchLabel,
  previousQuestions = [],
  responseFormat = "standard"
}: PromptBuildInput): string {
  const focusInstruction =
    topicFocus.trim().length > 0
      ? `Prioritize this topic focus when selecting question material: "${topicFocus.trim()}".`
      : "No explicit topic focus was supplied. Choose the most central concepts from the source packet.";

  const batchInstruction = batchLabel ? `- Working batch: ${batchLabel}.` : "";
  const previousQuestionBlock =
    previousQuestions.length > 0
      ? `\nAVOID_DUPLICATES_WITH_PREVIOUS_BATCHES\n${previousQuestions
          .map((question, index) => `PREVIOUS_QUESTION_${index + 1}: ${question}`)
          .join("\n")}\n`
      : "";

  const standardSchema = `{
  "questions": [
    {
      "question": "string",
      "options": ["A", "B", "C", "D"],
      "correctAnswer": "string",
      "explanation": "string",
      "source": {
        "file": "string",
        "page": "string",
        "chunkId": "string"
      }
    }
  ]
}`;
  const compactSchema = `{"questions":[["question",["A","B","C","D"],0,"short explanation",["file","page","chunkId"]]]}`;
  const formatInstruction =
    responseFormat === "compact"
      ? [
          "12) Use compact response mode.",
          "13) Return minified JSON on as few lines as possible.",
          '14) In compact mode, each question must be: ["question", ["A","B","C","D"], correctIndex, "short explanation", ["file","page","chunkId"]].',
          '15) "correctIndex" must be 0, 1, 2, or 3.',
          "16) Keep explanations short and factual."
        ].join("\n")
      : "";
  const requiredSchema = responseFormat === "compact" ? compactSchema : standardSchema;

  return `You are a strict quiz-generation engine.

TASK
- Generate exactly ${questionCount} multiple-choice questions (MCQs), no more and no less.
- Difficulty target: ${formatDifficulty(difficulty)}.
- ${focusInstruction}
${batchInstruction}

HARD CONSTRAINTS
1) Use ONLY facts that are explicitly present in SOURCE_PACKET. Do not infer facts that are not stated.
2) Return JSON only. Do not use Markdown, code fences, commentary, or additional keys.
3) Output must match the schema exactly.
4) The "questions" array must contain exactly ${questionCount} items.
5) Each question must contain exactly 4 options.
6) "correctAnswer" must exactly match one of the 4 options.
7) "explanation" must be concise and must reference why the correct option is supported by source text.
8) "source.file" and "source.chunkId" are mandatory.
9) If page is unknown, set "source.page" to "unknown" but still provide chunkId.
10) Preserve source grounding. No hallucinations.
11) Avoid generating question stems that substantially overlap with any prior accepted question listed below.
${formatInstruction}

REQUIRED JSON SCHEMA
${requiredSchema}

QUALITY CHECK BEFORE YOU RETURN
- Verify there are exactly ${questionCount} questions.
- Verify every question has 4 options.
- Verify ${responseFormat === "compact" ? "each correctIndex points to the intended correct option." : "each correctAnswer equals one of that question's options."}
- Verify each question includes source.file, source.page, and source.chunkId${responseFormat === "compact" ? " in the compact tuple." : "."}
${previousQuestionBlock}

SOURCE_PACKET_START
${sourcePacket(chunks)}
SOURCE_PACKET_END`;
}

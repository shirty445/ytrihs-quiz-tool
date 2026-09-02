import type {
  CognitiveMix,
  Difficulty,
  OptionCount,
  ResponseFormat,
  SourceChunk,
  SourceDetail
} from "@/lib/types";
import { optionLabels } from "@/lib/quiz/options";

interface PromptBuildInput {
  chunks: SourceChunk[];
  difficulty: Difficulty;
  topicFocus: string;
  questionCount?: number;
  batchLabel?: string;
  previousQuestions?: string[];
  responseFormat?: ResponseFormat;
  optionCount?: OptionCount;
  questionStyle?: string;
  customPromptInstructions?: string;
  sourceDetail?: SourceDetail;
  cognitiveMix?: CognitiveMix;
}

function formatDifficulty(difficulty: Difficulty, questionCount: number): string {
  switch (difficulty) {
    case "easy":
      return "easy";
    case "medium":
      return "medium";
    case "hard":
      return "hard";
    case "mixed": {
      const easy = Math.max(1, Math.round(questionCount * 0.3));
      const hard = Math.max(1, Math.round(questionCount * 0.2));
      const medium = Math.max(1, questionCount - easy - hard);
      return `mixed levels (about ${easy} easy, ${medium} medium, ${hard} hard)`;
    }
    default:
      return "medium";
  }
}

function formatCognitiveMix(cognitiveMix: CognitiveMix): string {
  switch (cognitiveMix) {
    case "recall":
      return "Mostly direct recall of stated definitions, values, and facts.";
    case "application":
      return "Mostly application and analysis: apply a stated rule to a new case, compare two stated concepts, or infer a consequence that the source explicitly supports. Keep pure recall to at most a third of the batch.";
    case "balanced":
    default:
      return "Roughly half direct recall of stated facts, half application or comparison of stated concepts.";
  }
}

function sourcePacket(chunks: SourceChunk[], sourceDetail: SourceDetail): string {
  return chunks
    .map((chunk, index) => {
      const page = chunk.page ? String(chunk.page) : "unknown";
      const content = sourceDetail === "full" ? chunk.rawText : chunk.compressedText;
      return [
        `SOURCE_${index + 1}`,
        `file: ${chunk.fileName}`,
        `page: ${page}`,
        `chunkId: ${chunk.chunkId}`,
        `content: ${content}`
      ].join("\n");
    })
    .join("\n\n");
}

function coverageBlock(chunks: SourceChunk[], questionCount: number): string {
  if (chunks.length === 0) {
    return "";
  }

  const chunkIds = chunks.map((chunk) => chunk.chunkId);
  const requirement =
    questionCount >= chunkIds.length
      ? `Every chunkId listed below must be cited by at least one question. Do not leave any of them unused.`
      : `You have fewer questions than chunks. Spread the questions across as many different chunkIds as possible and never take more than one question from the same chunkId until every chunkId has been used once.`;

  return `
COVERAGE REQUIREMENT
${requirement}
Chunk IDs in this batch (${chunkIds.length}):
${chunkIds.map((chunkId) => `- ${chunkId}`).join("\n")}
`;
}

function formatCustomInstructions(customPromptInstructions: string): string {
  const lines = customPromptInstructions
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return "";
  }

  return `\nCUSTOM INSTRUCTIONS\n${lines.map((line) => `- ${line}`).join("\n")}\n`;
}

function buildStandardSchema(optionCount: number): string {
  const optionPlaceholders = optionLabels(optionCount)
    .map((label) => `"Option ${label}"`)
    .join(", ");

  return `{
  "questions": [
    {
      "question": "string",
      "options": [${optionPlaceholders}],
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
}

function buildCompactSchema(optionCount: number): string {
  const optionPlaceholders = optionLabels(optionCount)
    .map((label) => `"${label}"`)
    .join(",");

  return `{"questions":[["question",[${optionPlaceholders}],0,"short explanation",["file","page","chunkId"]]]}`;
}

export function buildMasterPrompt({
  chunks,
  difficulty,
  topicFocus,
  questionCount = 5,
  batchLabel,
  previousQuestions = [],
  responseFormat = "standard",
  optionCount = 4,
  questionStyle = "",
  customPromptInstructions = "",
  sourceDetail = "compressed",
  cognitiveMix = "balanced"
}: PromptBuildInput): string {
  const focusInstruction =
    topicFocus.trim().length > 0
      ? `Prioritize this topic focus when selecting question material: "${topicFocus.trim()}".`
      : "No explicit topic focus was supplied. Choose the most central concepts from the source packet.";
  const styleInstruction =
    questionStyle.trim().length > 0
      ? `- Preferred question style: ${questionStyle.trim()}.`
      : "";

  const batchInstruction = batchLabel ? `- Working batch: ${batchLabel}.` : "";
  const previousQuestionBlock =
    previousQuestions.length > 0
      ? `\nAVOID_DUPLICATES_WITH_PREVIOUS_BATCHES\n${previousQuestions
          .map((question, index) => `PREVIOUS_QUESTION_${index + 1}: ${question}`)
          .join("\n")}\n`
      : "";

  const optionRange = optionLabels(optionCount);
  const correctIndexMax = optionCount - 1;
  const standardSchema = buildStandardSchema(optionCount);
  const compactSchema = buildCompactSchema(optionCount);
  const formatInstruction =
    responseFormat === "compact"
      ? [
          "12) Use compact response mode.",
          "13) Return minified JSON on as few lines as possible.",
          `14) In compact mode, each question must be: ["question", [${optionRange.map((label) => `"${label}"`).join(", ")}], correctIndex, "short explanation", ["file","page","chunkId"]].`,
          `15) "correctIndex" must be 0 through ${correctIndexMax}.`,
          "16) Keep explanations short and factual."
        ].join("\n")
      : "";
  const requiredSchema = responseFormat === "compact" ? compactSchema : standardSchema;
  const customInstructionBlock = formatCustomInstructions(customPromptInstructions);
  const coverageRequirement = coverageBlock(chunks, questionCount);

  return `You are a strict quiz-generation engine.

TASK
- Target about ${questionCount} multiple-choice questions (MCQs). A slightly lower or higher count is acceptable if it improves source-grounded quality.
- Difficulty target: ${formatDifficulty(difficulty, questionCount)}.
- Cognitive mix: ${formatCognitiveMix(cognitiveMix)}
- ${focusInstruction}
${styleInstruction}
${batchInstruction}

HARD CONSTRAINTS
1) Use ONLY facts that are explicitly present in SOURCE_PACKET. Do not infer facts that are not stated.
2) Return JSON only. Do not use Markdown, code fences, commentary, or additional keys.
3) Output must match the schema exactly.
4) Aim for roughly ${questionCount} items in the "questions" array.
5) Each question must contain exactly ${optionCount} options.
6) "correctAnswer" must exactly match one of the ${optionCount} options, character for character.
7) "explanation" must be concise and must reference why the correct option is supported by source text.
8) "source.file" and "source.chunkId" are mandatory, and "source.chunkId" must be copied verbatim from the chunk the question came from. Never invent a chunkId.
9) If page is unknown, set "source.page" to "unknown" but still provide chunkId.
10) Preserve source grounding. No hallucinations.
11) Avoid generating question stems that substantially overlap with any prior accepted question listed below.

QUESTION STEM RULES
12) The stem must be answerable by someone who knows the material without reading the options first.
13) Do not copy a sentence from the source and blank out a word. Rephrase, so the question tests understanding rather than recall of the exact phrasing.
14) Ask about one thing per question. No compound questions.
15) Do not write negative stems ("Which is NOT...") unless the custom instructions ask for them.

ANSWER OPTION RULES
16) Every distractor must be plausible to someone who studied this material but misunderstood it. Prefer real terms, values, or concepts that appear elsewhere in the source over invented ones.
17) All ${optionCount} options must be mutually exclusive, and exactly one must be defensible from the source.
18) Keep options similar in length and specificity. The correct answer must not be systematically the longest, most detailed, or most hedged option.
19) Never use "All of the above", "None of the above", "Both A and B", or similar meta-options.
20) Do not put absolute qualifiers ("always", "never", "all", "no") in distractors as a tell, and do not make the correct answer the only option that is carefully qualified.
21) Options must not repeat each other's text.
${formatInstruction}
${customInstructionBlock}
${coverageRequirement}
REQUIRED JSON SCHEMA
${requiredSchema}

QUALITY CHECK BEFORE YOU RETURN
- Verify the response stays reasonably close to the target of ${questionCount} questions.
- Verify every question has ${optionCount} options and that no two options within a question repeat.
- Verify ${responseFormat === "compact" ? "each correctIndex points to the intended correct option." : "each correctAnswer equals one of that question's options exactly."}
- Verify each question includes source.file, source.page, and source.chunkId${responseFormat === "compact" ? " in the compact tuple." : "."}
- Verify every chunkId you used appears in the batch's chunk list above.
- Re-read your options and confirm the correct answer cannot be identified by length, detail, or hedging alone.
${previousQuestionBlock}

SOURCE_PACKET_START
${sourcePacket(chunks, sourceDetail)}
SOURCE_PACKET_END`;
}

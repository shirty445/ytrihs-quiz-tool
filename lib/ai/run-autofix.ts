import { requestCompletion } from "@/lib/ai/client";
import { estimateQuestionTokens, type AiChatMessage } from "@/lib/ai/provider";
import { AUDIT_FLAG_LABELS, type QuestionAudit } from "@/lib/quiz/audit";
import { resolveSourceText } from "@/lib/prompt/build-review-prompt";
import { parseQuizResponse } from "@/lib/quiz/parse";
import { buildQuizJsonSchema } from "@/lib/quiz/schema";
import type { AiConnectionSettings, AiProviderKind, QuizQuestion, SourceChunk } from "@/lib/types";

const AUTOFIX_SYSTEM_PROMPT =
  "You repair flawed multiple-choice questions without changing what they test. You return only raw JSON matching the requested schema. Never use Markdown, code fences, or commentary.";

function buildAutofixPrompt(question: QuizQuestion, audit: QuestionAudit, sourceText: string): string {
  const issues = audit.flags.map((flag) => `- ${AUDIT_FLAG_LABELS[flag]}`);
  const notes = audit.notes.map((note) => `- ${note}`);
  const optionCount = question.options.length;

  return `Rewrite the question below to fix its flaws. Keep testing the same fact. Do not invent content that the source text does not support.

FLAWS TO FIX
${issues.join("\n")}
${notes.length > 0 ? `\nDETAIL\n${notes.join("\n")}` : ""}

RULES
1) Return exactly one question in the "questions" array.
2) Keep exactly ${optionCount} options, and keep "correctAnswer" identical in meaning to the current correct answer.
3) "correctAnswer" must match one of the options character for character.
4) Make all options similar in length and specificity. The correct answer must not be the longest or most hedged.
5) Distractors must be plausible misunderstandings drawn from the source, mutually exclusive, and free of "All of the above"-style meta-options.
6) Rephrase the stem so it is not copied from the source, and so it is answerable without reading the options.
7) Keep "source" exactly as given.
8) Return JSON only.

REQUIRED JSON SCHEMA
{"questions":[{"question":"string","options":[${Array.from({ length: optionCount }, (_, index) => `"option ${index + 1}"`).join(",")}],"correctAnswer":"string","explanation":"string","source":{"file":"string","page":"string","chunkId":"string"}}]}

CURRENT QUESTION
stem: ${question.question}
${question.options.map((option, index) => `option ${index + 1}: ${option}`).join("\n")}
correctAnswer: ${question.correctAnswer}
explanation: ${question.explanation}
source: {"file":"${question.source.file}","page":"${question.source.page}","chunkId":"${question.source.chunkId}"}

SOURCE_TEXT_START
${sourceText.trim() || "(unavailable — keep the existing facts, only fix the structural flaws)"}
SOURCE_TEXT_END`;
}

export type AutofixOutcome =
  | { ok: true; index: number; question: QuizQuestion }
  | { ok: false; index: number; errors: string[] };

export async function autofixQuestion(
  index: number,
  question: QuizQuestion,
  audit: QuestionAudit,
  chunks: SourceChunk[],
  options: { connection: AiConnectionSettings; kind: AiProviderKind; signal?: AbortSignal }
): Promise<AutofixOutcome> {
  const { connection, kind, signal } = options;
  const optionCount = question.options.length;

  const messages: AiChatMessage[] = [
    { role: "system", content: AUTOFIX_SYSTEM_PROMPT },
    { role: "user", content: buildAutofixPrompt(question, audit, resolveSourceText(question, chunks)) }
  ];

  let text: string;
  try {
    text = await requestCompletion({
      connection,
      kind,
      messages,
      jsonSchema: buildQuizJsonSchema(optionCount),
      signal,
      outputTokenHint: estimateQuestionTokens(optionCount)
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed.";
    return { ok: false, index, errors: [signal?.aborted ? "Run stopped." : message] };
  }

  const parsed = parseQuizResponse(text, "standard", optionCount);
  if (!parsed.success || !parsed.data || parsed.data.questions.length === 0) {
    return { ok: false, index, errors: parsed.errors };
  }

  const rewritten = parsed.data.questions[0];

  return {
    ok: true,
    index,
    question: {
      ...rewritten,
      // The model may drift on citation; the original grounding is authoritative.
      source: question.source,
      ...(question.review ? { review: undefined } : {})
    }
  };
}

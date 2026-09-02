import { optionLabels } from "@/lib/quiz/options";
import type { QuizQuestion, SourceChunk } from "@/lib/types";

export interface ReviewPromptItem {
  /** 1-based position within this enrichment group. */
  questionNumber: number;
  question: QuizQuestion;
  sourceText: string;
}

/**
 * Finds the raw source text behind a question.
 *
 * Enrichment deliberately re-attaches `rawText` rather than the compressed
 * summary the question was generated from, so the deep dive is grounded in the
 * full passage.
 */
export function resolveSourceText(question: QuizQuestion, chunks: SourceChunk[]): string {
  const exact = chunks.find((chunk) => chunk.chunkId === question.source.chunkId);
  if (exact) {
    return exact.rawText;
  }

  const sameFile = chunks.filter((chunk) => chunk.fileName === question.source.file);
  if (sameFile.length > 0) {
    return sameFile
      .slice(0, 3)
      .map((chunk) => chunk.rawText)
      .join("\n\n");
  }

  return "";
}

function formatQuestion(item: ReviewPromptItem): string {
  const labels = optionLabels(item.question.options.length);
  const correctIndex = item.question.options.indexOf(item.question.correctAnswer);

  const lines = [
    `QUESTION_${item.questionNumber}`,
    `stem: ${item.question.question}`,
    ...item.question.options.map((option, index) => `option ${index + 1} (${labels[index]}): ${option}`),
    `correct option number: ${correctIndex >= 0 ? correctIndex + 1 : "unknown"}`,
    `correct option text: ${item.question.correctAnswer}`,
    `existing short explanation: ${item.question.explanation}`,
    `source: ${item.question.source.file} | page ${item.question.source.page} | ${item.question.source.chunkId}`
  ];

  if (item.sourceText.trim().length > 0) {
    lines.push(`source text:\n${item.sourceText.trim()}`);
  } else {
    lines.push("source text: (unavailable — rely only on the question and its existing explanation)");
  }

  return lines.join("\n");
}

export function buildReviewPrompt(input: {
  items: ReviewPromptItem[];
  optionCount: number;
  batchLabel?: string;
}): string {
  const { items, optionCount, batchLabel } = input;
  const numbers = items.map((item) => item.questionNumber);

  return `You are writing study material for a learner who just got a question wrong. Your job is to make sure they never get it wrong again.

TASK
- Write a deep review for each of the ${items.length} question${items.length === 1 ? "" : "s"} below.${batchLabel ? `\n- Working group: ${batchLabel}.` : ""}
- Return one review object per question, with "questionNumber" set to ${numbers.join(", ")} respectively.

HARD CONSTRAINTS
1) Return JSON only. No Markdown, no code fences, no commentary, no extra keys.
2) Ground every claim in the provided source text. Do not introduce outside facts. If the source text does not settle something, say what the source does state instead of speculating.
3) "optionRationales" must have exactly ${optionCount} entries, in the SAME ORDER as the options are listed (option 1 first). Entry i explains option i.
4) For the correct option, the rationale states plainly why it is right.
5) For each wrong option, the rationale must do two things: name the specific misunderstanding that would make someone pick it, and state what that option WOULD be the correct answer to. This is the most important field — a learner who picked it should finish reading knowing exactly where their thinking went wrong.
6) "coreIdea" states the underlying principle being tested in 1-2 sentences, not a restatement of the question.
7) "whyCorrect" explains the correct answer using the source's own reasoning, not just an assertion that it is correct.
8) "keyFacts" is 2 to 5 short, atomic, self-contained facts. Each must stand alone without the question. These are what the learner memorizes.
9) "memoryHook" is one concrete contrast, analogy, or mnemonic that makes the correct answer stick. Prefer a sharp contrast with the most tempting wrong answer over a generic tip.
10) "commonConfusion" names the single trap this question sets.
11) "sourceQuote" is a short VERBATIM span copied from the source text that supports the correct answer. Copy it exactly. If no source text was provided, quote the existing explanation instead.
12) Write in plain, direct language. No filler, no "it is important to note", no restating the question.

REQUIRED JSON SCHEMA
{
  "reviews": [
    {
      "questionNumber": 1,
      "coreIdea": "string",
      "whyCorrect": "string",
      "optionRationales": [${Array.from({ length: optionCount }, (_, index) => `"why option ${index + 1} is right or wrong"`).join(", ")}],
      "keyFacts": ["string"],
      "memoryHook": "string",
      "commonConfusion": "string",
      "sourceQuote": "string"
    }
  ]
}

QUALITY CHECK BEFORE YOU RETURN
- Verify there are exactly ${items.length} review object${items.length === 1 ? "" : "s"}, with questionNumber values ${numbers.join(", ")}.
- Verify every "optionRationales" array has exactly ${optionCount} entries in option order.
- Verify "sourceQuote" appears verbatim in the source text you were given.
- Verify each wrong-option rationale names the misconception, not just "this is incorrect".

QUESTIONS_START
${items.map(formatQuestion).join("\n\n")}
QUESTIONS_END`;
}

import type { PromptDensity, ResponseFormat } from "@/lib/types";

export const PROMPT_DENSITY_PRESETS: Record<
  PromptDensity,
  { label: string; questionsPerPrompt: number; description: string }
> = {
  light: {
    label: "Light",
    questionsPerPrompt: 3,
    description: "Most reliable. Uses more prompts with fewer questions per batch."
  },
  standard: {
    label: "Standard",
    questionsPerPrompt: 5,
    description: "Balanced default for most models."
  },
  dense: {
    label: "Dense",
    questionsPerPrompt: 8,
    description: "Fewer prompts, better for stronger models."
  }
};

export const QUESTIONS_PER_PROMPT_OPTIONS = [2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50, 60, 75, 100];

export function normalizeQuestionsPerPrompt(value: number): number {
  if (!Number.isFinite(value)) {
    return PROMPT_DENSITY_PRESETS.standard.questionsPerPrompt;
  }

  return Math.max(1, Math.min(100, Math.round(value)));
}

function lighterDensity(mode: PromptDensity): PromptDensity {
  if (mode === "dense") {
    return "standard";
  }
  return "light";
}

export function buildPromptFailureAdvice(input: {
  expectedCount: number;
  actualCount: number;
  promptDensity: PromptDensity;
  questionsPerPrompt: number;
  responseFormat: ResponseFormat;
}): string {
  const nextDensity = lighterDensity(input.promptDensity);
  const lighterQuestionCount =
    input.promptDensity === "dense"
      ? PROMPT_DENSITY_PRESETS.standard.questionsPerPrompt
      : Math.max(2, Math.min(3, input.questionsPerPrompt - 1));

  const direction =
    input.actualCount < input.expectedCount ? "returned too few questions" : "returned too many questions";

  const compactAdvice =
    input.responseFormat === "standard"
      ? " If it still struggles, turn on compact response mode."
      : "";

  return `This model ${direction} for the current batch. Try ${PROMPT_DENSITY_PRESETS[nextDensity].label} mode at ${lighterQuestionCount} questions per prompt.${compactAdvice}`;
}

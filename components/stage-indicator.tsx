import type { ProcessingStage } from "@/lib/types";

const STAGE_ORDER: ProcessingStage[] = [
  "uploading",
  "extracting",
  "analyzing",
  "building_prompt",
  "waiting_for_ai",
  "parsed_success"
];

const LABELS: Record<ProcessingStage, string> = {
  idle: "Idle",
  uploading: "Uploading",
  extracting: "Extracting",
  analyzing: "Analyzing",
  building_prompt: "Building Prompt",
  waiting_for_ai: "Waiting For AI Output",
  parsed_success: "Parsed Successfully",
  failed: "Failed"
};

interface StageIndicatorProps {
  stage: ProcessingStage;
}

export function StageIndicator({ stage }: StageIndicatorProps) {
  const activeIndex = STAGE_ORDER.indexOf(stage);

  return (
    <ol className="stage-list" aria-label="Processing stages">
      {STAGE_ORDER.map((item, index) => {
        const isCompleted = activeIndex >= 0 && index < activeIndex;
        const isActive = item === stage;
        return (
          <li
            key={item}
            className={`stage-item${isCompleted ? " completed" : ""}${isActive ? " active" : ""}`}
          >
            <span className="stage-dot" aria-hidden="true" />
            <span>{LABELS[item]}</span>
          </li>
        );
      })}

      {stage === "failed" ? (
        <li className="stage-item active failed">
          <span className="stage-dot" aria-hidden="true" />
          <span>{LABELS.failed}</span>
        </li>
      ) : null}
    </ol>
  );
}

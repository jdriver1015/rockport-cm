import { cn } from "@/lib/utils";
import { stageLabel, type ProjectStageKey } from "@/lib/stages";

// Not-started stages read muted; Ready/In Progress are the active "info" blue;
// Punch is the pending amber; anything past Complete reads positive/done.
const STAGE_COLOR: Record<ProjectStageKey, string> = {
  planned: "text-text-muted",
  bidding: "text-text-muted",
  ready: "text-info",
  in_progress: "text-info",
  punch: "text-pending",
  complete: "text-positive",
  invoiced: "text-positive",
  closed: "text-positive",
};

export function StageDot({
  stage,
  className,
}: {
  stage: ProjectStageKey | string;
  className?: string;
}) {
  const color = STAGE_COLOR[stage as ProjectStageKey] ?? "text-text-muted";
  const label = stageLabel(stage);
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[13px] font-semibold", color, className)}>
      <span className="size-[7px] shrink-0 rounded-full bg-current" />
      {label}
    </span>
  );
}

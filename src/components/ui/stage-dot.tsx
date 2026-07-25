import { cn } from "@/lib/utils";
import { phaseLabel, type ProjectPhaseKey } from "@/lib/stages";

const PHASE_COLOR: Record<ProjectPhaseKey, string> = {
  precon: "text-text-muted",
  in_process: "text-info",
  punch: "text-pending",
  complete: "text-positive",
};

export function StageDot({
  phase,
  className,
}: {
  phase: ProjectPhaseKey | string;
  className?: string;
}) {
  const color = PHASE_COLOR[phase as ProjectPhaseKey] ?? "text-text-muted";
  const label = phaseLabel(phase);
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[13px] font-semibold", color, className)}>
      <span className="size-[7px] shrink-0 rounded-full bg-current" />
      {label}
    </span>
  );
}

import { cn } from "@/lib/utils";
import { phaseLabel, type ProjectPhaseKey } from "@/lib/stages";

const PHASE_COLOR: Record<ProjectPhaseKey, string> = {
  precon: "text-text-muted",
  in_process: "text-info",
  punch: "text-pending",
  complete: "text-positive",
};

/**
 * The phase ramp from the Gantt, so a dot in a table and a band on the chart
 * mean the same thing. Pale for pre-con through the brand navy for complete.
 */
const PHASE_BG: Record<ProjectPhaseKey, string> = {
  precon: "bg-phase-precon",
  in_process: "bg-phase-in-process",
  punch: "bg-phase-punch",
  complete: "bg-phase-complete",
};

/** The phase as colour alone — for a cell with no room for a word. */
export function PhaseDot({ phase, className }: { phase: ProjectPhaseKey | string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-block size-[7px] shrink-0 rounded-full",
        PHASE_BG[phase as ProjectPhaseKey] ?? "bg-ink-200",
        className,
      )}
      title={phaseLabel(phase)}
      aria-label={phaseLabel(phase)}
    />
  );
}

export function StageDot({
  phase,
  className,
}: {
  phase: ProjectPhaseKey | string;
  className?: string;
}) {
  const color = PHASE_COLOR[phase as ProjectPhaseKey] ?? "text-text-muted";
  const label = phaseLabel(phase);
  // min-w-0 + truncate, because a table cell can be narrower than the label and
  // an inline-flex with neither sizes itself to its content and renders straight
  // over whatever sits next to it. "Punch and Sign Off" needs 145px and was
  // being handed 66px, which is how it ended up printed across the date column.
  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-center gap-1.5 text-[13px] font-semibold whitespace-nowrap",
        color,
        className,
      )}
      title={label}
    >
      <span className="size-[7px] shrink-0 rounded-full bg-current" />
      <span className="truncate">{label}</span>
    </span>
  );
}

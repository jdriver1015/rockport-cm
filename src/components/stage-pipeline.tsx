import { PROJECT_PHASES, phaseIndex } from "@/lib/stages";
import { cn } from "@/lib/utils";

export function StagePipeline({ current }: { current: string }) {
  const activeIdx = phaseIndex(current);
  return (
    <ol className="flex flex-wrap gap-1.5">
      {PROJECT_PHASES.map((phase, i) => {
        const state = i < activeIdx ? "done" : i === activeIdx ? "active" : "todo";
        return (
          <li
            key={phase.key}
            title={phase.gate}
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium",
              state === "done" && "border-transparent bg-band text-navy",
              state === "active" && "border-transparent bg-navy text-white",
              state === "todo" && "border-dashed text-muted-foreground",
            )}
          >
            {state === "done" && <span aria-hidden>✓</span>}
            {phase.label}
          </li>
        );
      })}
    </ol>
  );
}

import { PROJECT_STAGES, stageIndex } from "@/lib/stages";
import { cn } from "@/lib/utils";

export function StagePipeline({ current }: { current: string }) {
  const activeIdx = stageIndex(current);
  return (
    <ol className="flex flex-wrap gap-1.5">
      {PROJECT_STAGES.map((stage, i) => {
        const state = i < activeIdx ? "done" : i === activeIdx ? "active" : "todo";
        return (
          <li
            key={stage.key}
            title={stage.gate}
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium",
              state === "done" && "border-transparent bg-paper text-navy",
              state === "active" && "border-transparent bg-navy text-white",
              state === "todo" && "border-dashed text-muted-foreground",
            )}
          >
            {state === "done" && <span aria-hidden>✓</span>}
            {stage.label}
          </li>
        );
      })}
    </ol>
  );
}

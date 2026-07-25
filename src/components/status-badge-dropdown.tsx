"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { PROJECT_PHASES, phaseLabel } from "@/lib/stages";
import { setProjectPhase } from "@/lib/actions/projects";

export function StatusBadgeDropdown({
  projectId,
  phase,
}: {
  projectId: number;
  phase: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function change(toPhase: string) {
    if (toPhase === phase) return;
    const fd = new FormData();
    fd.set("projectId", String(projectId));
    fd.set("toPhase", toPhase);
    startTransition(async () => {
      const res = await setProjectPhase(fd);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={pending}
        className={cn(
          "inline-flex items-center gap-1 rounded-full border border-border bg-secondary px-3 py-1 text-sm font-medium text-secondary-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60",
        )}
      >
        {phaseLabel(phase)}
        <span aria-hidden className="text-xs text-muted-foreground">
          ▾
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        {PROJECT_PHASES.map((p) => (
          <DropdownMenuItem key={p.key} onClick={() => change(p.key)}>
            {p.label}
            {p.key === phase && <CheckIcon className="ml-auto size-4" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

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
import { PROJECT_STAGES, stageLabel } from "@/lib/stages";
import { setProjectStage } from "@/lib/actions/projects";

export function StatusBadgeDropdown({
  projectId,
  stage,
}: {
  projectId: number;
  stage: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function change(toStage: string) {
    if (toStage === stage) return;
    const fd = new FormData();
    fd.set("projectId", String(projectId));
    fd.set("toStage", toStage);
    startTransition(async () => {
      const res = await setProjectStage(fd);
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
        {stageLabel(stage)}
        <span aria-hidden className="text-xs text-muted-foreground">
          ▾
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        {PROJECT_STAGES.map((s) => (
          <DropdownMenuItem key={s.key} onClick={() => change(s.key)}>
            {s.label}
            {s.key === stage && <CheckIcon className="ml-auto size-4" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { setProjectPhase } from "@/lib/actions/projects";

export function AdvancePhaseButton({
  projectId,
  toPhase,
  label,
  gate,
}: {
  projectId: number;
  toPhase: string;
  label: string;
  gate: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      title={`Gate: ${gate}`}
      disabled={pending}
      onClick={() => {
        const fd = new FormData();
        fd.set("projectId", String(projectId));
        fd.set("toPhase", toPhase);
        startTransition(async () => {
          const result = await setProjectPhase(fd);
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          router.refresh();
        });
      }}
    >
      Advance to {label}
    </Button>
  );
}

"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { restoreProject } from "@/lib/actions/projects";

export function RestoreProjectButton({ projectId }: { projectId: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          const fd = new FormData();
          fd.set("projectId", String(projectId));
          const res = await restoreProject(fd);
          if (!res.ok) {
            toast.error(res.error);
            return;
          }
          toast.success("Project restored");
          router.refresh();
        });
      }}
    >
      {pending ? "Restoring…" : "Restore"}
    </Button>
  );
}

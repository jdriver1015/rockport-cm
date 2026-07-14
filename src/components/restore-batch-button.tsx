"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { restoreBatch } from "@/lib/actions/gl";

export function RestoreBatchButton({ batchId }: { batchId: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          const res = await restoreBatch(batchId);
          if (!res.ok) {
            toast.error(res.error);
            return;
          }
          toast.success("Import restored");
          router.refresh();
        });
      }}
    >
      {pending ? "Restoring…" : "Restore"}
    </Button>
  );
}

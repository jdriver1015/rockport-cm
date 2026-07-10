"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { unpostTransaction } from "@/lib/actions/gl";

export function UnpostButton({ transactionId }: { transactionId: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() => {
        if (!window.confirm("Un-post this transaction? It returns to the review queue and JTD reverts.")) {
          return;
        }
        startTransition(async () => {
          try {
            await unpostTransaction(transactionId);
            toast.success("Un-posted — back in the review queue");
            router.refresh();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to un-post");
          }
        });
      }}
    >
      {pending ? "…" : "Un-post"}
    </Button>
  );
}

"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { deleteBatch, restoreBatch } from "@/lib/actions/gl";

export function DeleteBatchButton({
  propertyId,
  batchId,
  fileName,
}: {
  propertyId: number;
  batchId: number;
  fileName: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      size="sm"
      variant="ghost"
      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
      disabled={pending}
      onClick={() => {
        if (
          !window.confirm(`Delete the import "${fileName}"? This removes all of its staged and excluded rows.`)
        ) {
          return;
        }
        startTransition(async () => {
          const res = await deleteBatch(batchId);
          if (!res.ok) {
            toast.error(res.error);
            return;
          }
          toast.success("Import deleted", {
            action: {
              label: "Undo",
              onClick: () => {
                startTransition(async () => {
                  const undo = await restoreBatch(batchId);
                  if (!undo.ok) toast.error(undo.error);
                  router.refresh();
                });
              },
            },
          });
          router.push(`/properties/${propertyId}/gl`);
        });
      }}
    >
      {pending ? "Deleting…" : "Delete"}
    </Button>
  );
}

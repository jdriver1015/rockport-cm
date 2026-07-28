"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { deleteBatch, parseBatch, restoreBatch } from "@/lib/actions/rent-rolls";

export function RetryParseButton({ batchId }: { batchId: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          const res = await parseBatch(batchId);
          if (!res.ok) toast.error(res.error);
          router.refresh();
        });
      }}
    >
      {pending ? "Retrying…" : "Retry parse"}
    </Button>
  );
}

export function DeleteRentRollButton({
  propertySlug,
  batchId,
  fileName,
}: {
  propertySlug: string;
  batchId: number;
  fileName: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => {
        if (!window.confirm(`Delete the rent roll "${fileName}"?`)) return;
        startTransition(async () => {
          const res = await deleteBatch(batchId);
          if (!res.ok) {
            toast.error(res.error);
            return;
          }
          toast.success("Rent roll deleted");
          router.push(`/properties/${propertySlug}/rent-rolls`);
          router.refresh();
        });
      }}
    >
      Delete
    </Button>
  );
}

export function RestoreRentRollButton({ batchId }: { batchId: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          const res = await restoreBatch(batchId);
          if (!res.ok) {
            toast.error(res.error);
            return;
          }
          toast.success("Rent roll restored");
          router.refresh();
        });
      }}
    >
      Restore
    </Button>
  );
}

"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { restoreAudit } from "@/lib/actions/audits";

export function RestoreAuditButton({
  propertyId,
  auditId,
}: {
  propertyId: number;
  auditId: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          const res = await restoreAudit({ id: auditId, propertyId });
          if (!res.ok) {
            toast.error(res.error);
            return;
          }
          toast.success("Audit restored");
          router.refresh();
        });
      }}
    >
      {pending ? "Restoring…" : "Restore"}
    </Button>
  );
}

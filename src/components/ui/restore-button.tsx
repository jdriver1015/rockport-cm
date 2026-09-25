"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import type { VariantProps } from "class-variance-authority";
import type { ActionResult } from "@/lib/action-result";

/**
 * The restore half of every archive/restore pair in the app.
 *
 * No confirm step: restoring destroys nothing and is itself undone by
 * archiving again — a dialog here would be ceremony for a reversible act.
 * Every entity's restore button was this same few lines (call the action,
 * toast, refresh) copy-pasted with a different label; this is the one copy.
 */
export function RestoreButton({
  onRestore,
  successMessage,
  label = "Restore",
  variant = "ghost",
  size = "sm",
}: {
  onRestore: () => Promise<ActionResult>;
  successMessage: string;
  label?: string;
  variant?: VariantProps<typeof buttonVariants>["variant"];
  size?: VariantProps<typeof buttonVariants>["size"];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant={variant}
      size={size}
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          const result = await onRestore();
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          toast.success(successMessage);
          router.refresh();
        });
      }}
    >
      {pending ? "Restoring…" : label}
    </Button>
  );
}

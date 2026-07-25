"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { setScopeItemStatus } from "@/lib/actions/scope";
import { SCOPE_STATUSES, SCOPE_STATUS_COLOR, type ScopeStatusKey } from "@/lib/scope-status";
import { cn } from "@/lib/utils";

/**
 * Inline status control on a scope line — a PM updates progress from the table
 * without opening a dialog, since this is the field that changes most often.
 */
export function ScopeStatusSelect({
  id,
  propertyId,
  projectId,
  status,
}: {
  id: number;
  propertyId: number;
  projectId: number;
  status: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <select
      value={status}
      disabled={pending}
      aria-label="Scope line status"
      onChange={(e) => {
        const next = e.target.value;
        startTransition(async () => {
          const res = await setScopeItemStatus({ id, propertyId, projectId, status: next });
          if (!res.ok) {
            toast.error(res.error);
            return;
          }
          router.refresh();
        });
      }}
      className={cn(
        "h-7 rounded-control border border-input bg-transparent px-2 text-xs font-semibold outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50",
        SCOPE_STATUS_COLOR[status as ScopeStatusKey] ?? "text-ink-400",
      )}
    >
      {SCOPE_STATUSES.map((s) => (
        <option key={s.key} value={s.key}>
          {s.label}
        </option>
      ))}
    </select>
  );
}

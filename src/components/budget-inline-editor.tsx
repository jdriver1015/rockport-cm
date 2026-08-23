"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PencilIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setProjectBudget } from "@/lib/actions/project-budget";

/**
 * Set the approved budget from the cost bar itself.
 *
 * The bar is where the number is read, so it is where it should be changed.
 * Burying it in Manage → Edit meant looking at "no budget approved" with no
 * indication that you were two clicks from fixing it.
 *
 * Deliberately only the amount. The cost code is a decision about where spend
 * books, which belongs with the rest of the project's setup rather than beside
 * a progress bar.
 */
export function BudgetInlineEditor({
  projectId,
  approved,
}: {
  projectId: number;
  approved: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(approved > 0 ? String(approved) : "");

  function save() {
    const next = Number(value);
    if (value.trim() !== "" && (!Number.isFinite(next) || next < 0)) {
      toast.error("Enter a valid budget");
      return;
    }
    startTransition(async () => {
      const res = await setProjectBudget({ projectId, budgetAmount: value.trim() });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(next > 0 ? "Budget approved" : "Budget cleared");
      setEditing(false);
      router.refresh();
    });
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="inline-flex items-center gap-1 text-[12px] text-link transition-colors hover:underline"
      >
        <PencilIcon className="size-3" />
        {approved > 0 ? "Edit budget" : "Set a budget"}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[12px] text-muted-foreground">$</span>
      <Input
        autoFocus
        type="number"
        min="0"
        step="0.01"
        placeholder="25000"
        className="h-7 w-28 text-right text-[12.5px] tabular-nums"
        value={value}
        disabled={pending}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") {
            setValue(approved > 0 ? String(approved) : "");
            setEditing(false);
          }
        }}
        aria-label="Approved budget"
      />
      <Button size="sm" className="h-7 px-2.5 text-[12px]" disabled={pending} onClick={save}>
        Save
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 px-2 text-[12px]"
        disabled={pending}
        onClick={() => {
          setValue(approved > 0 ? String(approved) : "");
          setEditing(false);
        }}
      >
        Cancel
      </Button>
    </div>
  );
}

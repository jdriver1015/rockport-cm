"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { money } from "@/lib/format";
import { createBudgetLine } from "@/lib/actions/budget";

export type CategoryOption = { id: number; code: string; name: string };
export type CostCodeOption = {
  id: number;
  categoryId: number;
  code: string;
  name: string;
  isInterior: boolean;
};

export function AddBudgetLineDialog({
  propertyId,
  categories,
  costCodes,
  budgetedCostCodeIds,
}: {
  propertyId: number;
  categories: CategoryOption[];
  costCodes: CostCodeOption[];
  budgetedCostCodeIds: number[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [categoryId, setCategoryId] = useState("");
  const [costCodeId, setCostCodeId] = useState("");
  const [perUnitAmount, setPerUnitAmount] = useState("");
  const [plannedUnits, setPlannedUnits] = useState("");

  const budgetedIds = useMemo(() => new Set(budgetedCostCodeIds), [budgetedCostCodeIds]);

  const availableCodes = useMemo(
    () =>
      costCodes
        .filter((c) => String(c.categoryId) === categoryId)
        .filter((c) => !budgetedIds.has(c.id)),
    [costCodes, categoryId, budgetedIds],
  );

  const selectedCode = costCodes.find((c) => String(c.id) === costCodeId);
  const isInterior = selectedCode?.isInterior ?? false;

  const computedTotal =
    isInterior && perUnitAmount && plannedUnits
      ? parseFloat(perUnitAmount) * parseInt(plannedUnits, 10)
      : null;

  function reset() {
    setCategoryId("");
    setCostCodeId("");
    setPerUnitAmount("");
    setPlannedUnits("");
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      const fd = new FormData(e.currentTarget);
      const res = await createBudgetLine(fd);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Budget line added");
      setOpen(false);
      reset();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger render={<Button size="sm" />}>Add Budget Line</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add budget line</DialogTitle>
          <DialogDescription>
            Set the underwriting budget for a cost code from the chart of accounts.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <input type="hidden" name="propertyId" value={propertyId} />

          <div className="space-y-1.5">
            <Label htmlFor="budget-category">Category</Label>
            <select
              id="budget-category"
              value={categoryId}
              onChange={(e) => {
                setCategoryId(e.target.value);
                setCostCodeId("");
              }}
              required
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <option value="" disabled>
                Select a category…
              </option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="budget-code">Cost code</Label>
            <select
              id="budget-code"
              name="costCodeId"
              value={costCodeId}
              onChange={(e) => setCostCodeId(e.target.value)}
              required
              disabled={!categoryId}
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
            >
              <option value="" disabled>
                {categoryId ? "Select a cost code…" : "Choose a category first"}
              </option>
              {availableCodes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} {c.name}
                </option>
              ))}
            </select>
            {categoryId && availableCodes.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Every cost code in this category already has a budget line.
              </p>
            )}
          </div>

          {isInterior ? (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="budget-per-unit">Per unit ($)</Label>
                <Input
                  id="budget-per-unit"
                  name="perUnitAmount"
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  value={perUnitAmount}
                  onChange={(e) => setPerUnitAmount(e.target.value)}
                  placeholder="1,200.00"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="budget-units">Planned units</Label>
                <Input
                  id="budget-units"
                  name="plannedUnits"
                  type="number"
                  step="1"
                  min="0"
                  required
                  value={plannedUnits}
                  onChange={(e) => setPlannedUnits(e.target.value)}
                  placeholder="156"
                />
              </div>
              {computedTotal !== null && (
                <p className="col-span-2 text-xs text-muted-foreground">
                  Budgeted total: <span className="font-medium text-navy">{money(computedTotal)}</span>
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="budget-amount">Budgeted amount ($)</Label>
              <Input
                id="budget-amount"
                name="uwAmount"
                type="number"
                step="0.01"
                min="0"
                required
                placeholder="50,000.00"
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="budget-note">Note</Label>
            <Input id="budget-note" name="note" placeholder="Optional" />
          </div>

          <div className="flex justify-end">
            <Button type="submit" disabled={busy || (categoryId ? availableCodes.length === 0 : false)}>
              {busy ? "Adding…" : "Add Budget Line"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

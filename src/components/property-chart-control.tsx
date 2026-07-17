"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { updatePropertyChart } from "@/lib/actions/properties";

type ChartOption = { id: number; name: string; isDefault: boolean };

export function PropertyChartControl({
  propertyId,
  chartId,
  chartName,
  charts,
  locked,
  glCount,
  budgetLineCount,
  codedProjectCount,
}: {
  propertyId: number;
  chartId: number;
  chartName: string;
  charts: ChartOption[];
  locked: boolean;
  glCount: number;
  budgetLineCount: number;
  codedProjectCount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(chartId);

  const willClear = budgetLineCount > 0 || codedProjectCount > 0;

  async function handleSave() {
    if (selected === chartId) {
      setOpen(false);
      return;
    }
    setBusy(true);
    try {
      const result = await updatePropertyChart({ propertyId, chartOfAccountsId: selected });
      if (!result.ok) return toast.error(result.error);
      const bits: string[] = [];
      if (result.clearedBudgetLines) bits.push(`${result.clearedBudgetLines} budget line(s) cleared`);
      if (result.unlinkedProjects) bits.push(`${result.unlinkedProjects} project(s) unlinked`);
      toast.success(bits.length ? `Chart changed — ${bits.join(", ")}` : "Chart changed");
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span>
        Chart: <span className="font-medium text-foreground">{chartName}</span>
      </span>
      {locked ? (
        <span
          className="inline-flex items-center gap-1"
          title={`Locked — ${glCount} GL transaction${glCount === 1 ? "" : "s"} reference this chart's codes`}
        >
          <Lock className="size-3" /> Locked
        </span>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs"
          onClick={() => {
            setSelected(chartId);
            setOpen(true);
          }}
        >
          Change
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change chart of accounts</DialogTitle>
            <DialogDescription>
              This property has no GL activity yet, so its chart can still be changed.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="switch-chart">Chart of accounts</Label>
              <select
                id="switch-chart"
                value={selected}
                onChange={(e) => setSelected(Number(e.target.value))}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                {charts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.isDefault ? " (default)" : ""}
                  </option>
                ))}
              </select>
            </div>

            {willClear && selected !== chartId && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                Switching will clear this property&apos;s codes from the old chart:
                <ul className="mt-1 list-inside list-disc">
                  {budgetLineCount > 0 && (
                    <li>
                      {budgetLineCount} budget line{budgetLineCount === 1 ? "" : "s"} will be deleted
                    </li>
                  )}
                  {codedProjectCount > 0 && (
                    <li>
                      {codedProjectCount} project{codedProjectCount === 1 ? "" : "s"} will be unlinked
                      from their cost code
                    </li>
                  )}
                </ul>
                Re-code them against the new chart afterward.
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={busy || selected === chartId}>
              {busy ? "Changing…" : "Change chart"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

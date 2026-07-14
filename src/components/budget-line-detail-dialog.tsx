"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { money } from "@/lib/format";
import { stageLabel } from "@/lib/stages";
import { updateBudgetLine, deleteBudgetLine, restoreBudgetLine } from "@/lib/actions/budget";
import type { BudgetLineRow } from "@/components/budget-view";

export function BudgetLineDetailDialog({
  propertyId,
  line,
  onClose,
}: {
  propertyId: number;
  line: BudgetLineRow | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={line !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        {line && <DialogBody propertyId={propertyId} line={line} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

// Split out so form state resets each time a different line opens (fresh mount).
function DialogBody({
  propertyId,
  line,
  onClose,
}: {
  propertyId: number;
  line: BudgetLineRow;
  onClose: () => void;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      const fd = new FormData(e.currentTarget);
      const res = await updateBudgetLine({
        id: line.id,
        propertyId,
        uwAmount: line.isInterior ? undefined : String(fd.get("uwAmount") ?? ""),
        perUnitAmount: line.isInterior ? String(fd.get("perUnitAmount") ?? "") : undefined,
        plannedUnits: line.isInterior ? String(fd.get("plannedUnits") ?? "") : undefined,
        note: String(fd.get("note") ?? ""),
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Budget line updated");
      setEditing(false);
      onClose();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function handleDelete() {
    setBusy(true);
    (async () => {
      try {
        const res = await deleteBudgetLine({ id: line.id, propertyId });
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success("Budget line deleted", {
          action: {
            label: "Undo",
            onClick: () => {
              void (async () => {
                const undo = await restoreBudgetLine({ id: line.id, propertyId });
                if (!undo.ok) toast.error(undo.error);
                router.refresh();
              })();
            },
          },
        });
        onClose();
        router.refresh();
      } finally {
        setBusy(false);
      }
    })();
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          <span className="font-mono text-sm">{line.code}</span> {line.name}
        </DialogTitle>
        <DialogDescription>Underwriting budget line for this cost code.</DialogDescription>
      </DialogHeader>

      {editing ? (
        <form className="space-y-4" onSubmit={handleSave}>
          {line.isInterior ? (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="edit-per-unit">Per unit ($)</Label>
                <Input
                  id="edit-per-unit"
                  name="perUnitAmount"
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  defaultValue={line.perUnitAmount ?? ""}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-units">Planned units</Label>
                <Input
                  id="edit-units"
                  name="plannedUnits"
                  type="number"
                  step="1"
                  min="0"
                  required
                  defaultValue={line.plannedUnits ?? ""}
                />
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="edit-amount">Budgeted amount ($)</Label>
              <Input
                id="edit-amount"
                name="uwAmount"
                type="number"
                step="0.01"
                min="0"
                required
                defaultValue={line.budget}
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="edit-note">Note</Label>
            <Input id="edit-note" name="note" defaultValue={line.note ?? ""} placeholder="Optional" />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={busy} onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      ) : (
        <div className="space-y-4">
          <dl className="grid grid-cols-3 gap-3">
            <Figure label="Budgeted" value={money(line.budget)} />
            <Figure label="Committed" value={money(line.committed)} />
            <Figure label="Completed" value={money(line.completed)} />
          </dl>

          {line.isInterior && line.perUnitAmount !== null && line.plannedUnits !== null && (
            <p className="text-sm text-muted-foreground">
              {line.plannedUnits} units × {money(line.perUnitAmount)} per unit
            </p>
          )}
          {line.note && <p className="text-sm text-muted-foreground">{line.note}</p>}

          <div>
            <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Projects ({line.projects.length})
            </h4>
            {line.projects.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No projects are coded to this line yet.
              </p>
            ) : (
              <ul className="divide-y rounded-md border">
                {line.projects.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <Link
                      href={`/properties/${propertyId}/projects/${p.id}`}
                      className="min-w-0 flex-1 truncate font-medium text-navy hover:text-gold-link hover:underline"
                    >
                      {p.name}
                    </Link>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {stageLabel(p.stage)}
                    </span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {money(p.completed)} / {money(p.budget)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex justify-end gap-2 border-t pt-4">
            <Button variant="outline" disabled={busy} onClick={handleDelete}>
              Delete
            </Button>
            <Button disabled={busy} onClick={() => setEditing(true)}>
              Edit
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-paper/60 px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="tabular-nums font-medium text-navy">{value}</dd>
    </div>
  );
}

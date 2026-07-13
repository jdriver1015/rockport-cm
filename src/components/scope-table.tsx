"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { moneyExact, num } from "@/lib/format";
import { SCOPE_STATUSES } from "@/lib/scope";
import { createScopeItem, deleteScopeItem, updateScopeItem } from "@/lib/actions/scope";

export type ScopeRow = {
  id: number;
  item: string;
  quantity: string | null;
  unitCost: string | null;
  vendor: string | null;
  status: string;
};

function rowTotal(r: ScopeRow): number | null {
  if (r.quantity === null || r.unitCost === null) return null;
  return num(r.quantity) * num(r.unitCost);
}

export function ScopeTable({
  propertyId,
  projectId,
  items,
}: {
  propertyId: number;
  projectId: number;
  items: ScopeRow[];
}) {
  const total = items.reduce((s, r) => s + (rowTotal(r) ?? 0), 0);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base text-navy">Scope</CardTitle>
        <ScopeItemDialog propertyId={propertyId} projectId={projectId} />
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No scope items yet — add the first with “Add scope item”.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Unit cost</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Edit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((r) => (
                  <ScopeItemRow
                    key={r.id}
                    row={r}
                    propertyId={propertyId}
                    projectId={projectId}
                  />
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={3} className="font-semibold text-navy">
                    Total
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums text-navy">
                    {moneyExact(total)}
                  </TableCell>
                  <TableCell colSpan={3} />
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ScopeItemRow({
  row,
  propertyId,
  projectId,
}: {
  row: ScopeRow;
  propertyId: number;
  projectId: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const total = rowTotal(row);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok?: string) =>
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        toast.error(res.error ?? "Something went wrong");
        return;
      }
      if (ok) toast.success(ok);
      router.refresh();
    });

  return (
    <TableRow className={pending ? "opacity-60" : undefined}>
      <TableCell className="font-medium text-navy">{row.item}</TableCell>
      <TableCell className="text-right tabular-nums text-muted-foreground">
        {row.quantity === null ? "—" : num(row.quantity)}
      </TableCell>
      <TableCell className="text-right tabular-nums text-muted-foreground">
        {row.unitCost === null ? "—" : moneyExact(row.unitCost)}
      </TableCell>
      <TableCell className="text-right font-medium tabular-nums text-navy">
        {total === null ? "—" : moneyExact(total)}
      </TableCell>
      <TableCell className="text-muted-foreground">{row.vendor || "—"}</TableCell>
      <TableCell>
        <select
          disabled={pending}
          value={row.status}
          onChange={(e) =>
            run(() =>
              updateScopeItem({ id: row.id, propertyId, projectId, status: e.target.value }),
            )
          }
          className="h-7 rounded-md border border-input bg-transparent px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
        >
          {SCOPE_STATUSES.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-1">
          <ScopeItemDialog propertyId={propertyId} projectId={projectId} existing={row} />
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => {
              if (window.confirm(`Delete “${row.item}”?`)) {
                run(() => deleteScopeItem({ id: row.id, propertyId, projectId }), "Deleted");
              }
            }}
          >
            Delete
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

function ScopeItemDialog({
  propertyId,
  projectId,
  existing,
}: {
  propertyId: number;
  projectId: number;
  existing?: ScopeRow;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const editing = !!existing;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      const fd = new FormData(e.currentTarget);
      const res = editing
        ? await updateScopeItem({
            id: existing!.id,
            propertyId,
            projectId,
            item: String(fd.get("item") ?? ""),
            quantity: String(fd.get("quantity") ?? ""),
            unitCost: String(fd.get("unitCost") ?? ""),
            vendor: String(fd.get("vendor") ?? ""),
            status: String(fd.get("status") ?? "planned"),
          })
        : await createScopeItem(fd);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(editing ? "Scope item updated" : "Scope item added");
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save scope item");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button size="sm" variant={editing ? "ghost" : "default"} />}
      >
        {editing ? "Edit" : "Add scope item"}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Edit scope item" : "Add scope item"}</DialogTitle>
          <DialogDescription>A line of scoped work or materials for this project.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <input type="hidden" name="propertyId" value={propertyId} />
          <input type="hidden" name="projectId" value={projectId} />
          <div className="space-y-1.5">
            <Label htmlFor="scope-item">Item</Label>
            <Input
              id="scope-item"
              name="item"
              required
              defaultValue={existing?.item}
              placeholder="LVP flooring"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="scope-qty">Quantity</Label>
              <Input
                id="scope-qty"
                name="quantity"
                type="number"
                step="0.01"
                min="0"
                defaultValue={existing?.quantity ?? ""}
                placeholder="850"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="scope-unit">Unit cost ($)</Label>
              <Input
                id="scope-unit"
                name="unitCost"
                type="number"
                step="0.01"
                min="0"
                defaultValue={existing?.unitCost ?? ""}
                placeholder="3.20"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="scope-vendor">Vendor</Label>
            <Input
              id="scope-vendor"
              name="vendor"
              defaultValue={existing?.vendor ?? ""}
              placeholder="FloorCo"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="scope-status">Status</Label>
            <select
              id="scope-status"
              name="status"
              defaultValue={existing?.status ?? "planned"}
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              {SCOPE_STATUSES.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : editing ? "Save" : "Add scope item"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

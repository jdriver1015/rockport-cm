"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { EllipsisIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createScopeItem, deleteScopeItem, restoreScopeItem, updateScopeItem } from "@/lib/actions/scope";
import { money } from "@/lib/format";

export type ScopeRow = {
  id: number;
  item: string;
  materialQuality: string | null;
  productLink: string | null;
  category: string | null;
  status: string;
  quantity: string | null;
  unitPrice: string | null;
  costCodeId: number | null;
};

export type ScopeCostCodeOption = {
  id: number;
  code: string;
  name: string;
};

/** Underwriting budget for a cost code, and everything already allocated to it property-wide. */
export type CostCodeBudget = {
  budget: number;
  allocated: number;
};

export function ScopeTable({
  propertyId,
  projectId,
  items,
  costCodes,
  actualByCode,
  budgetByCode,
}: {
  propertyId: number;
  projectId: number;
  items: ScopeRow[];
  costCodes: ScopeCostCodeOption[];
  actualByCode: Record<number, number>;
  budgetByCode: Record<number, CostCodeBudget>;
}) {
  const codeById = useMemo(() => new Map(costCodes.map((c) => [c.id, c])), [costCodes]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base text-navy">Scope</CardTitle>
        <AddScopeItemButton propertyId={propertyId} projectId={projectId} costCodes={costCodes} budgetByCode={budgetByCode} />
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
                <TableRow className="hover:bg-transparent">
                  <TableHead>Item</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Units</TableHead>
                  <TableHead className="text-right">Unit cost</TableHead>
                  <TableHead className="text-right">Total cost</TableHead>
                  <TableHead className="text-right">Reconciled cost</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((row) => (
                  <ScopeItemRow
                    key={row.id}
                    row={row}
                    propertyId={propertyId}
                    projectId={projectId}
                    costCodes={costCodes}
                    budgetByCode={budgetByCode}
                    costCodeLabel={row.costCodeId != null ? codeById.get(row.costCodeId) : undefined}
                    actual={row.costCodeId != null ? actualByCode[row.costCodeId] ?? 0 : 0}
                  />
                ))}
              </TableBody>
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
  costCodes,
  budgetByCode,
  costCodeLabel,
  actual,
}: {
  row: ScopeRow;
  propertyId: number;
  projectId: number;
  costCodes: ScopeCostCodeOption[];
  budgetByCode: Record<number, CostCodeBudget>;
  costCodeLabel: ScopeCostCodeOption | undefined;
  actual: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editOpen, setEditOpen] = useState(false);

  const quantity = row.quantity != null ? Number(row.quantity) : null;
  const unitPrice = row.unitPrice != null ? Number(row.unitPrice) : null;
  const totalCost = quantity != null && unitPrice != null ? quantity * unitPrice : null;

  function handleDelete() {
    startTransition(async () => {
      const res = await deleteScopeItem({ id: row.id, propertyId, projectId });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Scope item deleted", {
        action: {
          label: "Undo",
          onClick: () => {
            startTransition(async () => {
              const undo = await restoreScopeItem({ id: row.id, propertyId, projectId });
              if (!undo.ok) toast.error(undo.error);
            });
          },
        },
      });
      router.refresh();
    });
  }

  return (
    <TableRow className={pending ? "opacity-60" : undefined}>
      <TableCell className="py-5 align-top">
        <div className="font-medium text-navy">{row.item}</div>
        <div className="mt-1 text-xs text-muted-foreground">
          {costCodeLabel ? `${costCodeLabel.code} — ${costCodeLabel.name}` : "—"}
        </div>
      </TableCell>
      <TableCell className="max-w-md whitespace-normal py-5 align-top text-muted-foreground">
        {row.materialQuality || "—"}
      </TableCell>
      <TableCell className="py-5 text-right tabular-nums">{quantity != null ? quantity.toLocaleString() : "—"}</TableCell>
      <TableCell className="py-5 text-right tabular-nums">{unitPrice != null ? money(unitPrice) : "—"}</TableCell>
      <TableCell className="py-5 text-right tabular-nums">{totalCost != null ? money(totalCost) : "—"}</TableCell>
      <TableCell className="py-5 text-right tabular-nums">{actual > 0 ? money(actual) : "—"}</TableCell>
      <TableCell className="py-5 text-right" onClick={(e) => e.stopPropagation()}>
        <DropdownMenu>
          <DropdownMenuTrigger disabled={pending} render={<Button variant="ghost" size="icon-sm" />}>
            <EllipsisIcon />
            <span className="sr-only">Actions</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setEditOpen(true)}>Edit</DropdownMenuItem>
            <DropdownMenuItem variant="destructive" disabled={pending} onClick={handleDelete}>
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <ScopeItemFormDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          propertyId={propertyId}
          projectId={projectId}
          existing={row}
          costCodes={costCodes}
          budgetByCode={budgetByCode}
        />
      </TableCell>
    </TableRow>
  );
}

function AddScopeItemButton({
  propertyId,
  projectId,
  costCodes,
  budgetByCode,
}: {
  propertyId: number;
  projectId: number;
  costCodes: ScopeCostCodeOption[];
  budgetByCode: Record<number, CostCodeBudget>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        Add scope item
      </Button>
      <ScopeItemFormDialog
        open={open}
        onOpenChange={setOpen}
        propertyId={propertyId}
        projectId={projectId}
        costCodes={costCodes}
        budgetByCode={budgetByCode}
      />
    </>
  );
}

function ScopeItemFormDialog({
  open,
  onOpenChange,
  propertyId,
  projectId,
  existing,
  costCodes,
  budgetByCode,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  propertyId: number;
  projectId: number;
  existing?: ScopeRow;
  costCodes: ScopeCostCodeOption[];
  budgetByCode: Record<number, CostCodeBudget>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const editing = !!existing;

  const [costCodeId, setCostCodeId] = useState(existing?.costCodeId != null ? String(existing.costCodeId) : "");
  const [quantity, setQuantity] = useState(existing?.quantity ?? "");
  const [unitPrice, setUnitPrice] = useState(existing?.unitPrice ?? "");

  // Local input state only initializes on mount, so re-pull it from the latest
  // `existing` every time the dialog opens — otherwise, after a save, closing
  // and reopening this same row's dialog shows the pre-save values (or blanks
  // out entirely) because the state never re-synced to the refreshed row.
  function syncFromExisting() {
    setCostCodeId(existing?.costCodeId != null ? String(existing.costCodeId) : "");
    setQuantity(existing?.quantity ?? "");
    setUnitPrice(existing?.unitPrice ?? "");
  }

  const selectedId = costCodeId ? Number(costCodeId) : null;
  const selectedBudget = selectedId != null ? budgetByCode[selectedId] : undefined;
  const ownOriginal =
    existing && existing.costCodeId === selectedId ? Number(existing.quantity ?? 0) * Number(existing.unitPrice ?? 0) : 0;
  const liveTotal = quantity && unitPrice ? Number(quantity) * Number(unitPrice) : 0;
  const baseAllocated = (selectedBudget?.allocated ?? 0) - ownOriginal;
  const remaining = selectedBudget ? selectedBudget.budget - baseAllocated - liveTotal : null;

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
            materialQuality: String(fd.get("materialQuality") ?? ""),
            quantity: String(fd.get("quantity") ?? ""),
            unitPrice: String(fd.get("unitPrice") ?? ""),
            costCodeId: selectedId,
          })
        : await createScopeItem(fd);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(editing ? "Scope item updated" : "Scope item added");
      onOpenChange(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save scope item");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (next) syncFromExisting();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Edit scope item" : "Add scope item"}</DialogTitle>
          <DialogDescription>
            The work and materials for this line — vendors price it in their bids.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <input type="hidden" name="propertyId" value={propertyId} />
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="costCodeId" value={costCodeId} />
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
          <div className="space-y-1.5">
            <Label htmlFor="scope-quality">Description</Label>
            <Textarea
              id="scope-quality"
              name="materialQuality"
              rows={4}
              defaultValue={existing?.materialQuality ?? ""}
              placeholder="20 mil wear layer, waterproof core"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="scope-quantity">Units</Label>
              <Input
                id="scope-quantity"
                name="quantity"
                type="number"
                step="0.01"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="1"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="scope-unit-price">Unit cost ($)</Label>
              <Input
                id="scope-unit-price"
                name="unitPrice"
                type="number"
                step="0.01"
                value={unitPrice}
                onChange={(e) => setUnitPrice(e.target.value)}
                placeholder="1,200.00"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="scope-cost-code">Budget line</Label>
            <select
              id="scope-cost-code"
              value={costCodeId}
              onChange={(e) => setCostCodeId(e.target.value)}
              className="h-9 w-full rounded-control border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <option value="">—</option>
              {costCodes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.name}
                </option>
              ))}
            </select>
            {selectedBudget && (
              <p className="text-xs text-muted-foreground">
                Total budget: <span className="font-medium text-navy">{money(selectedBudget.budget)}</span>
                {" · "}
                Remaining after this line:{" "}
                <span className={`font-medium ${remaining != null && remaining < 0 ? "text-red-600" : "text-navy"}`}>
                  {money(remaining ?? 0)}
                </span>
              </p>
            )}
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

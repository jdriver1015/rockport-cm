"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { EllipsisIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ComboboxSelect } from "@/components/ui/combobox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createScopeItem, deleteScopeItem, restoreScopeItem, updateScopeItem } from "@/lib/actions/scope";
import { money } from "@/lib/format";
import { cn } from "@/lib/utils";

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

const inputClass = "h-8 text-xs";

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
  const costCodeOptions = useMemo(
    () => costCodes.map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` })),
    [costCodes],
  );

  // A draft is a not-yet-created row added via "Add scope item". Once it's
  // saved server-side, its id shows up in `items` (after the next refresh) —
  // filtered out here at render time so the real row takes over instead of
  // showing twice, without needing an effect to prune state.
  const [drafts, setDrafts] = useState<{ key: string; createdId: number | null }[]>([]);
  const visibleDrafts = drafts.filter(
    (d) => d.createdId == null || !items.some((i) => i.id === d.createdId),
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base text-navy">Scope</CardTitle>
        <Button size="sm" onClick={() => setDrafts((ds) => [...ds, { key: crypto.randomUUID(), createdId: null }])}>
          Add scope item
        </Button>
      </CardHeader>
      <CardContent>
        {items.length === 0 && visibleDrafts.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No scope items yet — add the first with “Add scope item”.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Item</TableHead>
                  <TableHead>Budget line</TableHead>
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
                    costCodeOptions={costCodeOptions}
                    budgetByCode={budgetByCode}
                    actualByCode={actualByCode}
                  />
                ))}
                {visibleDrafts.map((d) => (
                  <ScopeItemRow
                    key={d.key}
                    row={null}
                    propertyId={propertyId}
                    projectId={projectId}
                    costCodeOptions={costCodeOptions}
                    budgetByCode={budgetByCode}
                    actualByCode={actualByCode}
                    onDraftCreated={(id) =>
                      setDrafts((ds) => ds.map((x) => (x.key === d.key ? { ...x, createdId: id } : x)))
                    }
                    onDraftRemoved={() => setDrafts((ds) => ds.filter((x) => x.key !== d.key))}
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
  costCodeOptions,
  budgetByCode,
  actualByCode,
  onDraftCreated,
  onDraftRemoved,
}: {
  row: ScopeRow | null;
  propertyId: number;
  projectId: number;
  costCodeOptions: { value: number; label: string }[];
  budgetByCode: Record<number, CostCodeBudget>;
  actualByCode: Record<number, number>;
  onDraftCreated?: (id: number) => void;
  onDraftRemoved?: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [id, setId] = useState<number | null>(row?.id ?? null);
  const [item, setItem] = useState(row?.item ?? "");
  const [materialQuality, setMaterialQuality] = useState(row?.materialQuality ?? "");
  const [quantity, setQuantity] = useState(row?.quantity ?? "");
  const [unitPrice, setUnitPrice] = useState(row?.unitPrice ?? "");
  const [costCodeId, setCostCodeId] = useState<number | null>(row?.costCodeId ?? null);

  // Fixed snapshot of what this row originally contributed to its budget code,
  // so the remaining-budget preview doesn't double-count this row's own spend.
  const originalCostCodeId = row?.costCodeId ?? null;
  const originalQuantity = row?.quantity ?? null;
  const originalUnitPrice = row?.unitPrice ?? null;

  type FieldPatch = Partial<{
    item: string;
    materialQuality: string;
    quantity: string;
    unitPrice: string;
    costCodeId: number | null;
  }>;

  function commit(patch: FieldPatch) {
    const next = {
      item: patch.item ?? item,
      materialQuality: patch.materialQuality ?? materialQuality,
      quantity: patch.quantity ?? quantity,
      unitPrice: patch.unitPrice ?? unitPrice,
      costCodeId: patch.costCodeId !== undefined ? patch.costCodeId : costCodeId,
    };
    startTransition(async () => {
      if (id == null) {
        if (!next.item.trim()) return; // nothing to create until there's an item name
        const res = await createScopeItem({
          propertyId,
          projectId,
          item: next.item,
          materialQuality: next.materialQuality || null,
          quantity: next.quantity || null,
          unitPrice: next.unitPrice || null,
          costCodeId: next.costCodeId,
        });
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        setId(res.id);
        onDraftCreated?.(res.id);
        router.refresh();
        return;
      }
      const res = await updateScopeItem({ id, propertyId, projectId, ...patch });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      router.refresh();
    });
  }

  function handleDelete() {
    if (id == null) {
      onDraftRemoved?.();
      return;
    }
    startTransition(async () => {
      const res = await deleteScopeItem({ id, propertyId, projectId });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Scope item deleted", {
        action: {
          label: "Undo",
          onClick: () => {
            startTransition(async () => {
              const undo = await restoreScopeItem({ id, propertyId, projectId });
              if (!undo.ok) toast.error(undo.error);
            });
          },
        },
      });
      router.refresh();
    });
  }

  const qtyNum = quantity ? Number(quantity) : null;
  const priceNum = unitPrice ? Number(unitPrice) : null;
  const totalCost = qtyNum != null && priceNum != null ? qtyNum * priceNum : null;
  const actual = costCodeId != null ? actualByCode[costCodeId] ?? 0 : 0;

  const selectedBudget = costCodeId != null ? budgetByCode[costCodeId] : undefined;
  const ownOriginal =
    originalCostCodeId === costCodeId ? Number(originalQuantity ?? 0) * Number(originalUnitPrice ?? 0) : 0;
  const liveTotal = totalCost ?? 0;
  const baseAllocated = (selectedBudget?.allocated ?? 0) - ownOriginal;
  const remaining = selectedBudget ? selectedBudget.budget - baseAllocated - liveTotal : null;

  return (
    <TableRow className={pending ? "opacity-60" : undefined}>
      <TableCell>
        <Input
          className={inputClass}
          value={item}
          placeholder="Item name"
          onChange={(e) => setItem(e.target.value)}
          onBlur={() => commit({ item })}
        />
      </TableCell>
      <TableCell className="align-top">
        <ComboboxSelect
          className="w-48"
          options={costCodeOptions}
          value={costCodeId}
          placeholder="Search codes…"
          emptyMessage="No matching cost codes"
          onValueChange={(next) => {
            setCostCodeId(next);
            commit({ costCodeId: next });
          }}
        />
        {selectedBudget && (
          <p className="mt-1 text-[11px] text-muted-foreground">
            Budget {money(selectedBudget.budget)} · Remaining{" "}
            <span className={cn("font-medium", remaining != null && remaining < 0 ? "text-red-600" : "text-navy")}>
              {money(remaining ?? 0)}
            </span>
          </p>
        )}
      </TableCell>
      <TableCell className="min-w-56">
        <Textarea
          className="min-h-8 text-xs"
          rows={1}
          value={materialQuality}
          placeholder="Description"
          onChange={(e) => setMaterialQuality(e.target.value)}
          onBlur={() => commit({ materialQuality })}
        />
      </TableCell>
      <TableCell className="text-right">
        <Input
          className={cn(inputClass, "w-16 text-right")}
          type="number"
          step="0.01"
          value={quantity}
          placeholder="1"
          onChange={(e) => setQuantity(e.target.value)}
          onBlur={() => commit({ quantity })}
        />
      </TableCell>
      <TableCell className="text-right">
        <Input
          className={cn(inputClass, "w-24 text-right")}
          type="number"
          step="0.01"
          value={unitPrice}
          placeholder="0.00"
          onChange={(e) => setUnitPrice(e.target.value)}
          onBlur={() => commit({ unitPrice })}
        />
      </TableCell>
      <TableCell className="text-right tabular-nums">{totalCost != null ? money(totalCost) : "—"}</TableCell>
      <TableCell className="text-right tabular-nums">{actual > 0 ? money(actual) : "—"}</TableCell>
      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
        <DropdownMenu>
          <DropdownMenuTrigger disabled={pending} render={<Button variant="ghost" size="icon-sm" />}>
            <EllipsisIcon />
            <span className="sr-only">Actions</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem variant="destructive" disabled={pending} onClick={handleDelete}>
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
}

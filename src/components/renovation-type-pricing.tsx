"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { EllipsisIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PRICING_METHOD_LABELS, type PricingMethod } from "@/lib/pricing";
import { cn } from "@/lib/utils";
import { addGroupLine, deleteGroupLine, updateTierDefaults } from "@/lib/actions/budget-groups";

export type PricingLine = {
  id: number;
  costCodeId: number;
  code: string;
  label: string;
  pricingMethod: PricingMethod;
  unitPrice: number;
  defaultQuantity: number | null;
  notes: string | null;
};

export type InteriorCodeChoice = { id: number; code: string; name: string };

/**
 * The two bases that are just a number. The others need extra inputs (a base to
 * take a percent of, a formula), so they stay read-only here and are edited in
 * the line dialog.
 */
const INLINE_METHODS = ["fixed", "sqft"] as const;
type InlineMethod = (typeof INLINE_METHODS)[number];
const isInline = (m: PricingMethod): m is InlineMethod =>
  (INLINE_METHODS as readonly string[]).includes(m);

const selectClass =
  "h-8 w-full rounded-control border border-input bg-transparent px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50";

type Edit = { pricingMethod: PricingMethod; unitPrice: string };

export function RenovationTypePricing({
  propertyId,
  budgetGroupId,
  lines,
  interiorCodes,
}: {
  propertyId: number;
  budgetGroupId: number;
  lines: PricingLine[];
  interiorCodes: InteriorCodeChoice[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [edits, setEdits] = useState<Record<number, Edit>>({});
  const [addSearch, setAddSearch] = useState("");
  const [adding, setAdding] = useState(false);

  const valueFor = (l: PricingLine): Edit =>
    edits[l.costCodeId] ?? {
      pricingMethod: l.pricingMethod,
      unitPrice: String(l.unitPrice),
    };

  // Batch save rather than save-on-blur: changing a default reprices every unit
  // planned into this type, so it gets an explicit commit and a report of how
  // many negotiated cells keep their own figure.
  const dirty = lines.filter((l) => {
    const v = edits[l.costCodeId];
    if (!v) return false;
    return v.pricingMethod !== l.pricingMethod || Number(v.unitPrice) !== l.unitPrice;
  });
  const invalid = dirty.some((l) => {
    const n = Number(valueFor(l).unitPrice);
    return !Number.isFinite(n) || n < 0;
  });

  const used = new Set(lines.map((l) => l.costCodeId));
  const available = interiorCodes.filter((c) => !used.has(c.id));
  const filtered = addSearch.trim()
    ? available.filter((c) => {
        const q = addSearch.toLowerCase();
        return c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q);
      })
    : available;

  function setEdit(costCodeId: number, patch: Partial<Edit>, base: PricingLine) {
    setEdits((e) => ({
      ...e,
      [costCodeId]: { ...valueForBase(e, base), ...patch },
    }));
  }
  function valueForBase(e: Record<number, Edit>, l: PricingLine): Edit {
    return e[l.costCodeId] ?? { pricingMethod: l.pricingMethod, unitPrice: String(l.unitPrice) };
  }

  function handleSave() {
    const payload = dirty.flatMap((l) => {
      const v = valueFor(l);
      return isInline(v.pricingMethod)
        ? [{ costCodeId: l.costCodeId, pricingMethod: v.pricingMethod, unitPrice: Number(v.unitPrice) }]
        : [];
    });
    if (payload.length === 0 || invalid) return;
    startTransition(async () => {
      const res = await updateTierDefaults({ propertyId, budgetGroupId, lines: payload });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        res.overriddenCells > 0
          ? `${res.updated} default(s) saved — ${res.overriddenCells} negotiated cell(s) keep their own figure`
          : `${res.updated} default(s) saved`,
      );
      setEdits({});
      router.refresh();
    });
  }

  function handleRemove(l: PricingLine, confirm = false) {
    startTransition(async () => {
      const res = await deleteGroupLine({ id: l.id, propertyId, confirm });
      if (!res.ok) {
        // The action refuses a line carrying negotiated overrides until told
        // twice — keep that as a deliberate second step, not a silent force.
        if (!confirm) {
          toast.error(res.error, {
            action: { label: "Remove anyway", onClick: () => handleRemove(l, true) },
            duration: 12000,
          });
          return;
        }
        toast.error(res.error);
        return;
      }
      toast.success(`Removed ${l.label}`);
      router.refresh();
    });
  }

  function handleAdd(costCodeId: number) {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("propertyId", String(propertyId));
      fd.set("budgetGroupId", String(budgetGroupId));
      fd.set("costCodeId", String(costCodeId));
      fd.set("pricingMethod", "fixed");
      fd.set("unitPrice", "0");
      const res = await addGroupLine(fd);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`Added ${interiorCodes.find((c) => c.id === costCodeId)?.name ?? "item"}`);
      setAdding(false);
      setAddSearch("");
      router.refresh();
    });
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Item</TableHead>
            <TableHead className="w-48">Basis</TableHead>
            <TableHead className="w-36 text-right">Amount</TableHead>
            <TableHead className="w-28 text-right">Default qty</TableHead>
            <TableHead>Notes</TableHead>
            <TableHead className="w-12" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                No priced items yet — add one for each cost code in this type.
              </TableCell>
            </TableRow>
          ) : (
            lines.map((l) => {
              const v = valueFor(l);
              const editable = isInline(v.pricingMethod);
              const changed = dirty.some((d) => d.costCodeId === l.costCodeId);
              return (
                <TableRow key={l.id} className={cn(pending && "opacity-60")}>
                  <TableCell>
                    <div className="font-medium text-navy">{l.label}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">{l.code}</div>
                  </TableCell>
                  <TableCell>
                    <select
                      value={v.pricingMethod}
                      disabled={pending}
                      aria-label={`${l.label} basis`}
                      onChange={(e) =>
                        setEdit(l.costCodeId, { pricingMethod: e.target.value as PricingMethod }, l)
                      }
                      className={selectClass}
                    >
                      {/* Only the two simple bases are offered; a line already on
                          another method keeps it as a visible option. */}
                      {INLINE_METHODS.map((m) => (
                        <option key={m} value={m}>
                          {PRICING_METHOD_LABELS[m]}
                        </option>
                      ))}
                      {!isInline(l.pricingMethod) && (
                        <option value={l.pricingMethod}>
                          {PRICING_METHOD_LABELS[l.pricingMethod]}
                        </option>
                      )}
                    </select>
                  </TableCell>
                  <TableCell className="text-right">
                    {editable ? (
                      <Input
                        className={cn("h-8 text-right text-xs", changed && "border-gold")}
                        type="number"
                        step="0.01"
                        min="0"
                        value={v.unitPrice}
                        disabled={pending}
                        onChange={(e) => setEdit(l.costCodeId, { unitPrice: e.target.value }, l)}
                      />
                    ) : (
                      <span className="text-xs tabular-nums text-muted-foreground">
                        Set in line details
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {l.defaultQuantity != null ? Number(l.defaultQuantity).toLocaleString() : "—"}
                  </TableCell>
                  <TableCell className="whitespace-normal text-xs text-muted-foreground">
                    {l.notes ?? "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        disabled={pending}
                        render={<Button variant="ghost" size="icon-sm" />}
                      >
                        <EllipsisIcon />
                        <span className="sr-only">Actions</span>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          variant="destructive"
                          disabled={pending}
                          onClick={() => handleRemove(l)}
                        >
                          Remove item
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })
          )}

          <TableRow className="hover:bg-transparent">
            <TableCell colSpan={6} className="border-t border-border bg-muted/30 py-2">
              {adding ? (
                <div className="space-y-2">
                  <Input
                    autoFocus
                    className="h-8 max-w-sm text-xs"
                    placeholder="Search interior cost codes…"
                    value={addSearch}
                    onChange={(e) => setAddSearch(e.target.value)}
                  />
                  <div className="max-h-48 overflow-y-auto rounded-control border border-border bg-card">
                    {filtered.length === 0 ? (
                      <p className="px-3 py-3 text-xs text-muted-foreground">
                        {available.length === 0
                          ? "Every interior cost code is already on this type."
                          : "No matching cost codes."}
                      </p>
                    ) : (
                      filtered.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          disabled={pending}
                          onClick={() => handleAdd(c.id)}
                          className="flex w-full items-baseline gap-2 border-b border-hairline px-3 py-2 text-left text-xs last:border-b-0 hover:bg-track"
                        >
                          <span className="font-medium text-navy">{c.name}</span>
                          <span className="text-muted-foreground">{c.code}</span>
                        </button>
                      ))
                    )}
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-4">
                  <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
                    + Add item
                  </Button>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">
                      {invalid
                        ? "Enter a non-negative amount."
                        : dirty.length === 0
                          ? "No changes yet."
                          : `${dirty.length} unsaved change${dirty.length === 1 ? "" : "s"}`}
                    </span>
                    <Button
                      size="sm"
                      disabled={pending || dirty.length === 0 || invalid}
                      onClick={handleSave}
                    >
                      Save defaults
                    </Button>
                  </div>
                </div>
              )}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}

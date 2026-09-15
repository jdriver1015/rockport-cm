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
import {
  INLINE_PRICING_METHODS,
  PRICING_METHOD_LABELS,
  type InlinePricingMethod,
  type PricingMethod,
} from "@/lib/pricing";
import { cn } from "@/lib/utils";
import {
  addRateAgreementLine,
  deleteRateAgreementLine,
  updateRateAgreementLines,
} from "@/lib/actions/rate-agreements";

export type AgreementPricingLine = {
  id: number;
  costCodeId: number;
  code: string;
  label: string;
  pricingMethod: PricingMethod;
  unitPrice: number;
};

export type InteriorCodeChoice = { id: number; code: string; name: string };

const isInline = (m: PricingMethod): m is InlinePricingMethod =>
  (INLINE_PRICING_METHODS as readonly string[]).includes(m);

const selectClass =
  "h-8 w-full rounded-control border border-input bg-transparent px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50";

type Edit = { pricingMethod: PricingMethod; unitPrice: string };

/**
 * A vendor's rate-sheet lines for one agreement — the same batch-edit grid
 * shape as RenovationTypePricing (a tier's own defaults), scoped to one
 * vendor's committed prices instead. Only fixed/sqft are editable inline,
 * matching that component; a line inherited from the tier at another method
 * shows read-only rather than silently flattening to one of these two.
 */
export function VendorRateAgreementPricing({
  propertyId,
  agreementId,
  lines,
  interiorCodes,
}: {
  propertyId: number;
  agreementId: number;
  lines: AgreementPricingLine[];
  interiorCodes: InteriorCodeChoice[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [edits, setEdits] = useState<Record<number, Edit>>({});
  const [addSearch, setAddSearch] = useState("");
  const [adding, setAdding] = useState(false);

  const valueFor = (l: AgreementPricingLine): Edit =>
    edits[l.costCodeId] ?? { pricingMethod: l.pricingMethod, unitPrice: String(l.unitPrice) };

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

  function setEdit(costCodeId: number, patch: Partial<Edit>, base: AgreementPricingLine) {
    setEdits((e) => ({
      ...e,
      [costCodeId]: { ...(e[costCodeId] ?? { pricingMethod: base.pricingMethod, unitPrice: String(base.unitPrice) }), ...patch },
    }));
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
      const res = await updateRateAgreementLines({ propertyId, agreementId, lines: payload });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`${res.updated} price${res.updated === 1 ? "" : "s"} saved`);
      setEdits({});
      router.refresh();
    });
  }

  function handleRemove(l: AgreementPricingLine) {
    startTransition(async () => {
      const res = await deleteRateAgreementLine({ id: l.id, propertyId });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`Removed ${l.label}`);
      router.refresh();
    });
  }

  function handleAdd(costCodeId: number) {
    startTransition(async () => {
      const res = await addRateAgreementLine({ agreementId, propertyId, costCodeId });
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
            <TableHead className="w-12" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                No priced items yet — add one for each cost code this vendor is quoting.
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
                      {INLINE_PRICING_METHODS.map((m) => (
                        <option key={m} value={m}>
                          {PRICING_METHOD_LABELS[m]}
                        </option>
                      ))}
                      {!isInline(l.pricingMethod) && (
                        <option value={l.pricingMethod}>{PRICING_METHOD_LABELS[l.pricingMethod]}</option>
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
                      <span className="text-xs tabular-nums text-muted-foreground">Not supported here</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger disabled={pending} render={<Button variant="ghost" size="icon-sm" />}>
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
            <TableCell colSpan={4} className="border-t border-border bg-muted/30 py-2">
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
                          ? "Every interior cost code is already on this agreement."
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
                    <Button size="sm" disabled={pending || dirty.length === 0 || invalid} onClick={handleSave}>
                      Save prices
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

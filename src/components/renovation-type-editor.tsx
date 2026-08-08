"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { money } from "@/lib/format";
import { PRICING_METHOD_LABELS, type PricingMethod } from "@/lib/pricing";
import { cn } from "@/lib/utils";
import { addGroupLine, updateTierDefaults } from "@/lib/actions/budget-groups";
import { updateInteriorSettings } from "@/lib/actions/interior-budget-plan";

/** One cost-code line of a renovation type's default pricing. */
export type EditorLine = {
  costCodeId: number;
  code: string;
  label: string;
  categoryName: string;
  pricingMethod: PricingMethod;
  unitPrice: number;
};
export type EditorTier = { id: number; name: string; lines: EditorLine[] };
export type EditorCodeChoice = { id: number; code: string; name: string };

/** The two bases editable inline; anything else is shown read-only. */
const INLINE_METHODS = ["fixed", "sqft"] as const;
const isInline = (m: PricingMethod): m is (typeof INLINE_METHODS)[number] =>
  (INLINE_METHODS as readonly string[]).includes(m);

const selectClass =
  "h-8 w-full rounded-md border border-input bg-transparent px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50";

/**
 * Edit a renovation type's defaults — the per-cost-code amounts every floorplan
 * planned into that type inherits.
 *
 * Custom overrides are per-cell negotiated amounts and are deliberately NOT touched,
 * so the save reports how many will keep their own figure instead of leaving the
 * edit looking inert.
 */
export function RenovationTypeEditor({
  propertyId,
  tiers,
  cmPct,
  contingencyPct,
  cmCostCodeId,
  contingencyCostCodeId,
  interiorCodes,
  open,
  onClose,
}: {
  propertyId: number;
  tiers: EditorTier[];
  cmPct: number;
  contingencyPct: number;
  cmCostCodeId: number | null;
  contingencyCostCodeId: number | null;
  interiorCodes: EditorCodeChoice[];
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [tierId, setTierId] = useState<number | null>(tiers[0]?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addSearch, setAddSearch] = useState("");
  /** Pending edits keyed by cost code — absent means untouched. */
  const [edits, setEdits] = useState<
    Record<number, { pricingMethod: PricingMethod; unitPrice: string }>
  >({});

  const tier = tiers.find((t) => t.id === tierId) ?? null;

  // Reset pending edits when the selected type changes, so a half-finished edit
  // on one type can't be saved onto another.
  const [lastTierId, setLastTierId] = useState(tierId);
  if (tierId !== lastTierId) {
    setLastTierId(tierId);
    setEdits({});
    setAdding(false);
    setAddSearch("");
  }

  const valueFor = (line: EditorLine) => edits[line.costCodeId] ?? {
    pricingMethod: line.pricingMethod,
    unitPrice: String(line.unitPrice),
  };

  const setLine = (
    line: EditorLine,
    patch: Partial<{ pricingMethod: PricingMethod; unitPrice: string }>,
  ) =>
    setEdits((prev) => ({
      ...prev,
      [line.costCodeId]: { ...valueFor(line), ...patch },
    }));

  const editable = (tier?.lines ?? []).filter((l) => isInline(l.pricingMethod));
  const dirty = editable.filter((l) => {
    const v = edits[l.costCodeId];
    if (!v) return false;
    return v.pricingMethod !== l.pricingMethod || Number(v.unitPrice) !== l.unitPrice;
  });
  const invalid = dirty.some((l) => {
    const n = Number(valueFor(l).unitPrice);
    return !Number.isFinite(n) || n < 0;
  });

  const existingCodeIds = new Set((tier?.lines ?? []).map((l) => l.costCodeId));
  const availableCodes = interiorCodes.filter((c) => !existingCodeIds.has(c.id));
  const filteredCodes = addSearch.trim()
    ? availableCodes.filter((c) => {
        const q = addSearch.toLowerCase();
        return c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q);
      })
    : availableCodes;

  async function handleAddLine(costCodeId: number) {
    if (!tier) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("propertyId", String(propertyId));
      fd.set("budgetGroupId", String(tier.id));
      fd.set("costCodeId", String(costCodeId));
      fd.set("pricingMethod", "fixed");
      fd.set("unitPrice", "0");
      const result = await addGroupLine(fd);
      if (!result.ok) return toast.error(result.error);
      const code = interiorCodes.find((c) => c.id === costCodeId);
      toast.success(`Added ${code?.name ?? "item"}`);
      setAdding(false);
      setAddSearch("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleSave() {
    if (!tier || dirty.length === 0) return;
    setBusy(true);
    try {
      const result = await updateTierDefaults({
        propertyId,
        budgetGroupId: tier.id,
        lines: dirty.map((l) => {
          const v = valueFor(l);
          return {
            costCodeId: l.costCodeId,
            pricingMethod: v.pricingMethod as "fixed" | "sqft",
            unitPrice: Number(v.unitPrice),
          };
        }),
      });
      if (!result.ok) return toast.error(result.error);
      toast.success(
        result.overriddenCells > 0
          ? `Saved ${result.updated} line${result.updated === 1 ? "" : "s"} — ${result.overriddenCells} custom override${result.overriddenCells === 1 ? "" : "s"} keep their amounts`
          : `Saved ${result.updated} line${result.updated === 1 ? "" : "s"}`,
      );
      setEdits({});
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setEdits({});
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Default Renovation Types</DialogTitle>
          <DialogDescription>
            The default cost of each item for this renovation. Every floorplan planned into it
            inherits these, except cells with a custom override.
          </DialogDescription>
        </DialogHeader>

        {tiers.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No renovation types yet. Create one under Unit Upgrades first.
          </p>
        ) : (
          <>
            {tiers.length > 1 && (
              <div className="flex gap-1.5">
                {tiers.map((t) => (
                  <Button
                    key={t.id}
                    type="button"
                    size="sm"
                    variant={t.id === tierId ? "default" : "outline"}
                    onClick={() => setTierId(t.id)}
                  >
                    {t.name}
                  </Button>
                ))}
              </div>
            )}

            <div className="max-h-[45vh] overflow-y-auto rounded-md border border-hairline">
              <table className="w-full border-collapse text-[13px]">
                <thead className="sticky top-0 bg-band">
                  <tr>
                    <th className="px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-700">
                      Item
                    </th>
                    <th className="w-40 px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-700">
                      Basis
                    </th>
                    <th className="w-32 px-2 py-1.5 text-right text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-700">
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(tier?.lines ?? []).map((line) => {
                    const v = valueFor(line);
                    const inline = isInline(line.pricingMethod);
                    return (
                      <tr key={line.costCodeId} className="border-t border-hairline">
                        <td className="px-2 py-1.5">
                          <span
                            className="block max-w-[20rem] truncate text-ink-700"
                            title={`${line.code} — ${line.label}`}
                          >
                            {line.label}
                          </span>
                          <span className="text-[10px] text-ink-400">{line.categoryName}</span>
                        </td>
                        <td className="px-2 py-1.5">
                          {inline ? (
                            <select
                              aria-label={`Basis for ${line.label}`}
                              value={v.pricingMethod}
                              onChange={(e) =>
                                setLine(line, { pricingMethod: e.target.value as PricingMethod })
                              }
                              className={selectClass}
                            >
                              <option value="fixed">Whole dollars</option>
                              <option value="sqft">Per square foot</option>
                            </select>
                          ) : (
                            <span
                              className="text-[11px] text-ink-400"
                              title="Edited from the Unit Upgrades line editor"
                            >
                              {PRICING_METHOD_LABELS[line.pricingMethod]}
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          {inline ? (
                            <Input
                              aria-label={`Amount for ${line.label}`}
                              type="number"
                              min="0"
                              step="0.01"
                              value={v.unitPrice}
                              onChange={(e) => setLine(line, { unitPrice: e.target.value })}
                              className="h-8 text-right text-xs tabular-nums"
                            />
                          ) : (
                            <span className="text-xs tabular-nums text-ink-400">
                              {money(line.unitPrice)}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {(tier?.lines ?? []).length === 0 && !adding && (
                    <tr>
                      <td colSpan={3} className="px-2 py-6 text-center text-sm text-muted-foreground">
                        No items yet — click &ldquo;Add item&rdquo; below.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {adding ? (
              <div className="space-y-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
                  <Input
                    autoFocus
                    placeholder="Search cost codes…"
                    value={addSearch}
                    onChange={(e) => setAddSearch(e.target.value)}
                    className="h-9 pl-8 text-sm"
                  />
                </div>
                <div className="max-h-48 overflow-y-auto rounded-md border border-hairline divide-y divide-hairline">
                  {filteredCodes.length === 0 ? (
                    <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                      {availableCodes.length === 0 ? "All interior cost codes are already on this tier." : "No matches."}
                    </p>
                  ) : (
                    filteredCodes.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        disabled={busy}
                        onClick={() => handleAddLine(c.id)}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-hover disabled:opacity-50"
                      >
                        <span className="shrink-0 text-[11px] tabular-nums text-ink-400">{c.code}</span>
                        <span className="truncate text-ink-700">{c.name}</span>
                      </button>
                    ))
                  )}
                </div>
                <div className="flex justify-end">
                  <Button type="button" variant="ghost" size="sm" onClick={() => { setAdding(false); setAddSearch(""); }}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : availableCodes.length > 0 && (
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="flex items-center gap-1.5 text-xs font-medium text-link hover:text-link/80"
              >
                <Plus className="size-3.5" />
                Add item
              </button>
            )}

            <UpliftCodesSection
              propertyId={propertyId}
              cmPct={cmPct}
              contingencyPct={contingencyPct}
              cmCostCodeId={cmCostCodeId}
              contingencyCostCodeId={contingencyCostCodeId}
              interiorCodes={interiorCodes}
            />

            <DialogFooter className="sm:justify-between">
              <span className="self-center text-[11px] text-muted-foreground">
                {dirty.length === 0
                  ? "No changes yet."
                  : `${dirty.length} line${dirty.length === 1 ? "" : "s"} changed.`}
              </span>
              <Button
                type="button"
                onClick={handleSave}
                disabled={busy || dirty.length === 0 || invalid}
              >
                {busy ? "Saving…" : "Save defaults"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Which cost codes the CM and contingency uplifts post to. Structural rather than
 * per-renovation, but it lives here because this is now the only settings surface
 * on the Interior view — without it the uplift dollars sit outside the cost-code
 * tree and the pivot stops reconciling to the Interiors division.
 */
function UpliftCodesSection({
  propertyId,
  cmPct,
  contingencyPct,
  cmCostCodeId,
  contingencyCostCodeId,
  interiorCodes,
}: {
  propertyId: number;
  cmPct: number;
  contingencyPct: number;
  cmCostCodeId: number | null;
  contingencyCostCodeId: number | null;
  interiorCodes: EditorCodeChoice[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const result = await updateInteriorSettings({
        propertyId,
        cmSupervisionPct: cmPct,
        contingencyPct,
        cmCostCodeId: fd.get("cmCostCodeId") ? Number(fd.get("cmCostCodeId")) : undefined,
        contingencyCostCodeId: fd.get("contingencyCostCodeId")
          ? Number(fd.get("contingencyCostCodeId"))
          : undefined,
      });
      if (!result.ok) return toast.error(result.error);
      toast.success("Uplift cost codes saved");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="rounded-md border border-hairline">
      <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-ink-700">
        Where uplift dollars post
      </summary>
      <form className="space-y-3 border-t border-hairline px-3 py-3" onSubmit={handleSubmit}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="rt-cm-code">CM / supervision</Label>
            <select
              id="rt-cm-code"
              name="cmCostCodeId"
              defaultValue={cmCostCodeId ?? ""}
              className={cn(selectClass, "h-9 text-sm")}
            >
              <option value="">Not attributed</option>
              {interiorCodes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rt-cont-code">Contingency</Label>
            <select
              id="rt-cont-code"
              name="contingencyCostCodeId"
              defaultValue={contingencyCostCodeId ?? ""}
              className={cn(selectClass, "h-9 text-sm")}
            >
              <option value="">Not attributed</option>
              {interiorCodes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Without these the uplift dollars sit outside the cost-code tree and the interior budget
          stops matching the Interiors division on the other views. Rates themselves are edited on
          the pivot.
        </p>
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={busy}>
            Save
          </Button>
        </div>
      </form>
    </details>
  );
}

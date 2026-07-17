"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  priceLine,
  scopeTotal,
  PRICING_METHOD_LABELS,
  type PricingMethod,
  type UnitMeta,
} from "@/lib/pricing";
import { createInteriorProject } from "@/lib/actions/interior-projects";

export type WizardUnit = {
  unitNumber: string;
  floorplan: string | null;
  bedrooms: number | null;
  baths: number | null;
  sqft: number | null;
};
export type WizardGroupItem = {
  id: number;
  name: string;
  category: string | null;
  pricingMethod: PricingMethod;
  unitPrice: number;
  defaultQuantity: number | null;
  quantityFormula: string | null;
  costCodeId: number | null;
  materialAssumptions: string | null;
};
export type WizardScopeGroup = { id: number; name: string; items: WizardGroupItem[] };
export type WizardVendor = { id: number; name: string; trade: string | null };

type Line = {
  sourceGroupItemId: number;
  name: string;
  category: string | null;
  pricingMethod: PricingMethod;
  costCodeId: number | null;
  materialAssumptions: string | null;
  quantity: number;
  unitPrice: number;
  note?: string;
};

const money = (v: number) =>
  `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const STEPS = ["Unit", "Scope group", "Review scope", "Vendor & dates", "Create"];

/** Price a group's items against the unit into editable review lines. */
function generateLines(group: WizardScopeGroup, unit: UnitMeta): Line[] {
  const base = scopeTotal(
    group.items
      .filter((it) => it.pricingMethod !== "percent")
      .map((it) =>
        priceLine(
          { method: it.pricingMethod, unitPrice: it.unitPrice, defaultQuantity: it.defaultQuantity, quantityFormula: it.quantityFormula },
          unit,
        ),
      ),
  );
  return group.items.map((it) => {
    const res = priceLine(
      {
        method: it.pricingMethod,
        unitPrice: it.unitPrice,
        defaultQuantity: it.defaultQuantity,
        quantityFormula: it.quantityFormula,
        percentBase: base,
      },
      unit,
    );
    // Percent lines resolve to a concrete dollar amount (qty 1 × total).
    const quantity = it.pricingMethod === "percent" ? 1 : res.quantity;
    const unitPrice = it.pricingMethod === "percent" ? res.total : it.unitPrice;
    return {
      sourceGroupItemId: it.id,
      name: it.name,
      category: it.category,
      pricingMethod: it.pricingMethod,
      costCodeId: it.costCodeId,
      materialAssumptions: it.materialAssumptions,
      quantity,
      unitPrice,
      note: res.note,
    };
  });
}

export function InteriorWizard({
  propertyId,
  units,
  groups,
  vendors,
}: {
  propertyId: number;
  units: WizardUnit[];
  groups: WizardScopeGroup[];
  vendors: WizardVendor[];
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);

  const [unitQuery, setUnitQuery] = useState("");
  const [unit, setUnit] = useState<WizardUnit | null>(null);
  const [groupId, setGroupId] = useState<number | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [vendorId, setVendorId] = useState<number | null>(null);
  const [preWalkDate, setPreWalkDate] = useState("");
  const [startDate, setStartDate] = useState("");
  const [targetCompletionDate, setTargetCompletionDate] = useState("");

  const group = groups.find((g) => g.id === groupId) ?? null;
  const total = useMemo(() => scopeTotal(lines.map((l) => ({ total: l.quantity * l.unitPrice }))), [lines]);

  const filteredUnits = useMemo(() => {
    const q = unitQuery.trim().toLowerCase();
    if (!q) return units;
    return units.filter(
      (u) => u.unitNumber.toLowerCase().includes(q) || (u.floorplan ?? "").toLowerCase().includes(q),
    );
  }, [units, unitQuery]);

  function chooseGroup(g: WizardScopeGroup) {
    setGroupId(g.id);
    if (unit) setLines(generateLines(g, { sqft: unit.sqft, bedrooms: unit.bedrooms, baths: unit.baths }));
  }

  function editLine(i: number, patch: Partial<Pick<Line, "quantity" | "unitPrice">>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  const canNext =
    (step === 0 && unit) ||
    (step === 1 && group) ||
    step === 2 ||
    step === 3 ||
    step === 4;

  async function handleCreate() {
    if (!unit || !group) return;
    setBusy(true);
    try {
      const result = await createInteriorProject({
        propertyId,
        scopeGroupId: group.id,
        unitNumber: unit.unitNumber,
        floorplan: unit.floorplan,
        bedrooms: unit.bedrooms,
        baths: unit.baths,
        sqft: unit.sqft,
        vendorId: vendorId ?? undefined,
        preWalkDate,
        startDate,
        targetCompletionDate,
        lines: lines.map((l) => ({
          name: l.name,
          category: l.category,
          pricingMethod: l.pricingMethod,
          unitPrice: l.unitPrice,
          quantity: l.quantity,
          costCodeId: l.costCodeId,
          sourceGroupItemId: l.sourceGroupItemId,
          materialAssumptions: l.materialAssumptions,
        })),
      });
      if (!result.ok) return toast.error(result.error);
      toast.success("Interior project created");
      router.push(`/properties/${propertyId}/projects/${result.projectId}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-navy">New interior project</CardTitle>
        <Stepper step={step} />
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Step 1 — unit */}
        {step === 0 && (
          <div className="space-y-3">
            <Input
              placeholder="Search unit or floor plan…"
              value={unitQuery}
              onChange={(e) => setUnitQuery(e.target.value)}
            />
            <div className="max-h-72 divide-y overflow-y-auto rounded-md border">
              {filteredUnits.map((u) => (
                <button
                  key={u.unitNumber}
                  type="button"
                  onClick={() => setUnit(u)}
                  className={cn(
                    "flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted/50",
                    unit?.unitNumber === u.unitNumber && "bg-paper",
                  )}
                >
                  <span className="font-medium text-navy">Unit {u.unitNumber}</span>
                  <span className="text-xs text-muted-foreground">
                    {[u.floorplan, u.bedrooms != null ? `${u.bedrooms} bd` : null, u.baths != null ? `${u.baths} ba` : null, u.sqft != null ? `${u.sqft} sf` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </button>
              ))}
              {filteredUnits.length === 0 && (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">No matching units.</p>
              )}
            </div>
          </div>
        )}

        {/* Step 2 — scope group */}
        {step === 1 && (
          <div className="space-y-2">
            {groups.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => chooseGroup(g)}
                className={cn(
                  "flex w-full items-center justify-between rounded-md border p-3 text-left text-sm transition-colors",
                  groupId === g.id ? "border-navy bg-paper" : "border-input hover:bg-muted/50",
                )}
              >
                <span className="font-medium text-navy">{g.name}</span>
                <span className="text-xs text-muted-foreground">
                  {g.items.length} item{g.items.length === 1 ? "" : "s"}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Step 3 — review scope */}
        {step === 2 && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Auto-generated for Unit {unit?.unitNumber}. Adjust quantities or prices as needed.
            </p>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-paper/60 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2 text-left">Item</th>
                    <th className="px-2 py-2 text-left">Method</th>
                    <th className="px-2 py-2 text-right">Qty</th>
                    <th className="px-2 py-2 text-right">Unit price</th>
                    <th className="px-2 py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {lines.map((l, i) => (
                    <tr key={l.sourceGroupItemId}>
                      <td className="px-2 py-1.5">
                        <div className="font-medium text-navy">{l.name}</div>
                        {l.note && <div className="text-[11px] text-amber-700">{l.note}</div>}
                      </td>
                      <td className="px-2 py-1.5 text-xs text-muted-foreground">
                        {PRICING_METHOD_LABELS[l.pricingMethod]}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={l.quantity}
                          onChange={(e) => editLine(i, { quantity: Number(e.target.value) })}
                          className="w-20 rounded border border-input bg-transparent px-1.5 py-1 text-right"
                        />
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={l.unitPrice}
                          onChange={(e) => editLine(i, { unitPrice: Number(e.target.value) })}
                          className="w-24 rounded border border-input bg-transparent px-1.5 py-1 text-right"
                        />
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {money(l.quantity * l.unitPrice)}
                      </td>
                    </tr>
                  ))}
                  {lines.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-2 py-6 text-center text-muted-foreground">
                        This scope group has no active items.
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr className="border-t bg-paper/40 font-semibold text-navy">
                    <td className="px-2 py-2" colSpan={4}>
                      Estimated total
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{money(total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        {/* Step 4 — vendor & dates */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="wz-vendor">Vendor</Label>
              <select
                id="wz-vendor"
                value={vendorId ?? ""}
                onChange={(e) => setVendorId(e.target.value ? Number(e.target.value) : null)}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <option value="">Unassigned</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                    {v.trade ? ` — ${v.trade}` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="wz-prewalk">Pre-walk</Label>
                <Input id="wz-prewalk" type="date" value={preWalkDate} onChange={(e) => setPreWalkDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wz-start">Start</Label>
                <Input id="wz-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wz-target">Target completion</Label>
                <Input
                  id="wz-target"
                  type="date"
                  value={targetCompletionDate}
                  onChange={(e) => setTargetCompletionDate(e.target.value)}
                />
              </div>
            </div>
          </div>
        )}

        {/* Step 5 — create */}
        {step === 4 && (
          <div className="space-y-2 text-sm">
            <Summary label="Unit" value={unit ? `Unit ${unit.unitNumber}` : "—"} />
            <Summary label="Scope group" value={group?.name ?? "—"} />
            <Summary label="Scope items" value={String(lines.length)} />
            <Summary label="Vendor" value={vendors.find((v) => v.id === vendorId)?.name ?? "Unassigned"} />
            <Summary label="Pre-walk" value={preWalkDate || "—"} />
            <Summary label="Start" value={startDate || "—"} />
            <Summary label="Target completion" value={targetCompletionDate || "—"} />
            <div className="flex items-center justify-between border-t pt-2 font-semibold text-navy">
              <span>Estimated budget</span>
              <span className="tabular-nums">{money(total)}</span>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between border-t pt-3">
          <Button variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || busy}>
            Back
          </Button>
          {step < STEPS.length - 1 ? (
            <Button onClick={() => setStep((s) => s + 1)} disabled={!canNext}>
              Next
            </Button>
          ) : (
            <Button onClick={handleCreate} disabled={busy || lines.length === 0}>
              {busy ? "Creating…" : "Create project"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Stepper({ step }: { step: number }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 pt-2 text-xs">
      {STEPS.map((label, i) => (
        <div key={label} className="flex items-center gap-1.5">
          <span
            className={cn(
              "flex size-5 items-center justify-center rounded-full text-[10px] font-semibold",
              i < step
                ? "bg-navy text-white"
                : i === step
                  ? "bg-gold text-navy"
                  : "bg-muted text-muted-foreground",
            )}
          >
            {i < step ? <Check className="size-3" /> : i + 1}
          </span>
          <span className={cn(i === step ? "font-medium text-navy" : "text-muted-foreground")}>{label}</span>
          {i < STEPS.length - 1 && <span className="mx-0.5 text-muted-foreground">›</span>}
        </div>
      ))}
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-navy">{value}</span>
    </div>
  );
}

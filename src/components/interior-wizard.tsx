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
  resolveGroupPricing,
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
export type WizardBudgetLine = {
  id: number;
  costCodeId: number;
  costCodeName: string;
  category: string | null;
  pricingMethod: PricingMethod;
  unitPrice: number;
  defaultQuantity: number | null;
  notes: string | null;
};
export type WizardBudgetGroup = { id: number; name: string; lines: WizardBudgetLine[] };
export type WizardVendor = { id: number; name: string; trade: string | null };

/** A pivot column group, so a unit can inherit its group's override amounts. */
export type WizardUnitGroup = {
  id: number;
  name: string;
  bedrooms: number | null;
  unitCount: number;
  floorPlanCodes: string[];
};
export type WizardPin = {
  unitGroupId: number;
  tierId: number;
  costCodeId: number;
  amount: number;
};
export type WizardAllocation = {
  unitGroupId: number;
  tierId: number;
  plannedUnits: number;
  actualUnits: number;
};

type Line = {
  sourceBudgetLineId: number;
  item: string;
  category: string | null;
  pricingMethod: PricingMethod;
  costCodeId: number;
  notes: string | null;
  quantity: number;
  unitPrice: number;
  note?: string;
};

const money = (v: number) =>
  `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const STEPS = ["Unit", "Budget group", "Review budget", "Vendor & dates", "Create"];

/**
 * Price a tier's lines against the chosen unit. All the arithmetic — including
 * the percent base — lives in resolveGroupPricing so the wizard, the budget
 * pivot, and the portfolio rollup can never disagree about a number.
 *
 * Pricing uses the ACTUAL unit's metadata (not its group's average) but inherits
 * the group's override amounts, so a project's budget matches its pivot cell on
 * every step-priced line while still flexing with the real square footage.
 */
function generateLines(
  group: WizardBudgetGroup,
  unit: UnitMeta,
  pins: { costCodeId: number; amount: number }[],
): Line[] {
  return resolveGroupPricing({ lines: group.lines, unit, pins }).perLine.map(
    ({ line, quantity, unitPrice, note }) => ({
      sourceBudgetLineId: line.id,
      item: line.costCodeName,
      category: line.category,
      pricingMethod: line.pricingMethod,
      costCodeId: line.costCodeId,
      notes: line.notes,
      quantity,
      unitPrice,
      note,
    }),
  );
}

/**
 * Which pivot column group a unit belongs to: its floorplan code first, then its
 * bedroom count. The wizard writes whatever floorplan string the rent roll had,
 * so an exact map hit isn't guaranteed.
 */
function resolveUnitGroup(unit: WizardUnit, unitGroups: WizardUnitGroup[]): WizardUnitGroup | null {
  if (unit.floorplan) {
    const byCode = unitGroups.find((g) => g.floorPlanCodes.includes(unit.floorplan!));
    if (byCode) return byCode;
  }
  if (unit.bedrooms != null) {
    const byBeds = unitGroups.find((g) => g.bedrooms === unit.bedrooms);
    if (byBeds) return byBeds;
  }
  return null;
}

export function InteriorWizard({
  propertyId,
  propertySlug,
  units,
  groups,
  vendors,
  unitGroups = [],
  pins = [],
  allocations = [],
}: {
  propertyId: number;
  propertySlug: string;
  units: WizardUnit[];
  groups: WizardBudgetGroup[];
  vendors: WizardVendor[];
  unitGroups?: WizardUnitGroup[];
  pins?: WizardPin[];
  allocations?: WizardAllocation[];
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

  const unitGroup = useMemo(
    () => (unit ? resolveUnitGroup(unit, unitGroups) : null),
    [unit, unitGroups],
  );

  const pinsFor = (tierId: number) =>
    unitGroup
      ? pins
          .filter((p) => p.unitGroupId === unitGroup.id && p.tierId === tierId)
          .map((p) => ({ costCodeId: p.costCodeId, amount: p.amount }))
      : [];

  /** Plan-vs-actual for this unit's group, to guide which tier to pick. */
  const allocationFor = (tierId: number) =>
    unitGroup
      ? allocations.find((a) => a.unitGroupId === unitGroup.id && a.tierId === tierId) ?? null
      : null;

  function chooseGroup(g: WizardBudgetGroup) {
    setGroupId(g.id);
    if (unit) {
      setLines(
        generateLines(
          g,
          { sqft: unit.sqft, bedrooms: unit.bedrooms, baths: unit.baths },
          pinsFor(g.id),
        ),
      );
    }
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
        budgetGroupId: group.id,
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
          item: l.item,
          category: l.category,
          pricingMethod: l.pricingMethod,
          unitPrice: l.unitPrice,
          quantity: l.quantity,
          costCodeId: l.costCodeId,
          sourceBudgetLineId: l.sourceBudgetLineId,
          notes: l.notes,
        })),
      });
      if (!result.ok) return toast.error(result.error);
      toast.success("Interior project created");
      router.push(`/properties/${propertySlug}/projects/${result.slug}`);
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
                    unit?.unitNumber === u.unitNumber && "bg-muted",
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

        {/* Step 2 — budget group */}
        {step === 1 && (
          <div className="space-y-2">
            {unitGroup ? (
              <p className="text-xs text-muted-foreground">
                Unit {unit?.unitNumber} falls in the{" "}
                <span className="font-medium text-navy">{unitGroup.name}</span> group
                {unitGroups.length > 0 && ` (${unitGroup.unitCount.toLocaleString()} units)`}.
              </p>
            ) : (
              unitGroups.length > 0 && (
                <p className="text-xs text-amber-700">
                  This unit&apos;s floorplan isn&apos;t in any unit group, so it won&apos;t count toward the
                  interior plan and won&apos;t inherit custom overrides.
                </p>
              )
            )}
            {groups.map((g) => {
              const alloc = allocationFor(g.id);
              const remaining = alloc ? alloc.plannedUnits - alloc.actualUnits : null;
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => chooseGroup(g)}
                  className={cn(
                    "flex w-full items-center justify-between rounded-md border p-3 text-left text-sm transition-colors",
                    groupId === g.id ? "border-navy bg-muted" : "border-input hover:bg-muted/50",
                  )}
                >
                  <span className="min-w-0">
                    <span className="block font-medium text-navy">{g.name}</span>
                    {alloc && (
                      <span className="text-[11px] text-muted-foreground">
                        Plan {alloc.plannedUnits.toLocaleString()} · started {alloc.actualUnits}
                        {remaining != null && remaining > 0 && ` · ≈${Math.round(remaining)} remaining`}
                        {remaining != null && remaining <= 0 && " · plan met"}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {g.lines.length} line{g.lines.length === 1 ? "" : "s"}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Step 3 — review budget */}
        {step === 2 && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Auto-generated for Unit {unit?.unitNumber}. Adjust quantities or prices as needed.
            </p>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted text-xs text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2 text-left">Cost code</th>
                    <th className="px-2 py-2 text-left">Method</th>
                    <th className="px-2 py-2 text-right">Qty</th>
                    <th className="px-2 py-2 text-right">Unit price</th>
                    <th className="px-2 py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {lines.map((l, i) => (
                    <tr key={l.sourceBudgetLineId}>
                      <td className="px-2 py-1.5">
                        <div className="font-medium text-navy">{l.item}</div>
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
                        This budget group has no lines.
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr className="border-t bg-muted font-semibold text-navy">
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
            <Summary label="Budget group" value={group?.name ?? "—"} />
            <Summary label="Budget lines" value={String(lines.length)} />
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
                ? "bg-ink-400 text-white"
                : i === step
                  ? "bg-ink-900 text-white"
                  : "bg-band text-ink-400",
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

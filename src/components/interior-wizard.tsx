"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  resolveGroupPricing,
  scopeTotal,
  PRICING_METHOD_LABELS,
  type PricingMethod,
  type UnitMeta,
} from "@/lib/pricing";
import { createInteriorProject } from "@/lib/actions/interior-projects";
import {
  DEFAULT_SCHEDULE,
  PRE_WALK_KEY,
  SCHEDULE_KEYS,
  SCHEDULE_LABELS,
  blankSchedule,
  describeDays,
  phaseRun,
  type ScheduleKey,
  type ScheduleSettings,
} from "@/lib/schedule-defaults";
import { DEFAULT_MILESTONES } from "@/lib/milestones";
import type { ProjectPhaseKey } from "@/lib/stages";
import { fmtDate } from "@/lib/format";
import { TargetPhasingStep } from "@/components/target-phasing-step";
import { TriggerChecklist } from "@/components/trigger-checklist";
import type { TriggerStep } from "@/lib/renovation-triggers";

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

/** A unit that already has an interior project, so it cannot be turned again. */
export type WizardTakenUnit = {
  unitNumber: string;
  /** Where that project has got to, so the row says why it is unavailable. */
  phaseLabel: string;
  href: string;
};

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

const STEPS = ["Unit", "Renovation type", "Review budget", "Target phasing", "Create"];

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
  unitGroups = [],
  pins = [],
  allocations = [],
  schedule,
  suggestedDates,
  takenUnits = [],
  triggerSteps = [],
}: {
  propertyId: number;
  propertySlug: string;
  units: WizardUnit[];
  groups: WizardBudgetGroup[];
  unitGroups?: WizardUnitGroup[];
  pins?: WizardPin[];
  allocations?: WizardAllocation[];
  /** Portfolio suggested schedule. Omitted in tests and older callers. */
  schedule?: ScheduleSettings;
  /**
   * The dates to prefill, computed on the server against one fixed timezone.
   * Not derived here from `new Date()`: this component is server-rendered too,
   * so that produced a different answer on each side of hydration.
   */
  suggestedDates?: Record<ScheduleKey, string>;
  /** Units already claimed by an interior project. */
  takenUnits?: WizardTakenUnit[];
  /** The property's pre-walk rule, shown as a checklist beside the type choice. */
  triggerSteps?: TriggerStep[];
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const [unitQuery, setUnitQuery] = useState("");
  const [unit, setUnit] = useState<WizardUnit | null>(null);
  const [groupId, setGroupId] = useState<number | null>(null);
  const [lines, setLines] = useState<Line[]>([]);

  // One map keyed by schedule key rather than three loose date fields. The old
  // shape let target completion sit before the pre-walk with nothing noticing,
  // and had no place to put the two milestones between them.
  const scheduleSettings = schedule ?? DEFAULT_SCHEDULE;
  // Held, not recomputed: a re-render must not overwrite a date already typed,
  // and the server already decided what "today" means.
  const [suggested] = useState<Record<ScheduleKey, string>>(
    () => suggestedDates ?? blankSchedule(),
  );
  const [dates, setDates] = useState<Record<ScheduleKey, string>>(suggested);


  function setDate(key: ScheduleKey, value: string) {
    setDates((prev) => ({ ...prev, [key]: value }));
  }

  // Ticked pre-walk findings. Recorded with the project so "why this type?" has
  // an answer later, but they never change the selection — see TriggerChecklist.
  const [checkedConditions, setCheckedConditions] = useState<Set<number>>(new Set());
  function toggleCondition(id: number, next: boolean) {
    setCheckedConditions((prev) => {
      const out = new Set(prev);
      if (next) out.add(id);
      else out.delete(id);
      return out;
    });
  }

  const takenByUnit = useMemo(
    () => new Map(takenUnits.map((t) => [t.unitNumber, t])),
    [takenUnits],
  );

  const availableCount = useMemo(
    () => units.filter((u) => !takenByUnit.has(u.unitNumber)).length,
    [units, takenByUnit],
  );

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

  // Anything past picking a unit is work that would be lost, so leaving asks
  // first. Step 0 with nothing chosen has nothing to discard, so it just leaves.
  const hasProgress = unit !== null || groupId !== null || step > 0;

  function leave() {
    router.push(`/properties/${propertySlug}/interiors`);
  }

  function requestCancel() {
    if (hasProgress) {
      setConfirmCancel(true);
      return;
    }
    leave();
  }

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
        preWalkDate: dates[PRE_WALK_KEY],
        // No start or target date on the project itself. Those columns hold what
        // ACTUALLY happened — startDate is stamped on entry to In Process — and
        // filling them here with a plan made one column mean the target until
        // the phase flipped and the real date afterwards. The plan lives on the
        // milestones, which is where it stays editable.
        milestones: DEFAULT_MILESTONES.map((m) => ({
          phase: m.phase,
          plannedDate: dates[m.phase] || undefined,
        })),
        checkedConditionIds: [...checkedConditions],
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
      toast.success("Unit upgrade created");
      router.push(`/properties/${propertySlug}/interiors`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-navy">New unit upgrade</CardTitle>
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
            {availableCount === 0 ? (
              <p className="rounded-card border border-border bg-muted/30 px-3 py-4 text-sm text-muted-foreground">
                Every unit on the current rent roll already has a unit upgrade. Finish or
                archive one before starting another.
              </p>
            ) : (
              takenUnits.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {availableCount.toLocaleString()} of {units.length.toLocaleString()} units
                  available — {takenUnits.length.toLocaleString()} already being renovated.
                </p>
              )
            )}
            <div className="max-h-72 divide-y overflow-y-auto rounded-md border">
              {filteredUnits.map((u) => {
                const meta = [
                  u.floorplan,
                  u.bedrooms != null ? `${u.bedrooms} bd` : null,
                  u.baths != null ? `${u.baths} ba` : null,
                  u.sqft != null ? `${u.sqft} sf` : null,
                ]
                  .filter(Boolean)
                  .join(" · ");
                const taken = takenByUnit.get(u.unitNumber);

                // A claimed unit is a row, not a disabled button: it carries a
                // link to the project holding it, and a disabled button would
                // swallow the click.
                if (taken) {
                  return (
                    <div
                      key={u.unitNumber}
                      className="flex items-center justify-between gap-3 bg-hairline/60 px-3 py-2 text-sm"
                    >
                      <span className="min-w-0">
                        <span className="font-medium text-ink-300">Unit {u.unitNumber}</span>
                        <span className="ml-2 text-xs text-ink-300">already being renovated</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2 text-xs">
                        <span className="text-muted-foreground">{taken.phaseLabel}</span>
                        <Link href={taken.href} className="text-link hover:underline">
                          Open
                        </Link>
                      </span>
                    </div>
                  );
                }

                return (
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
                    <span className="text-xs text-muted-foreground">{meta}</span>
                  </button>
                );
              })}
              {filteredUnits.length === 0 && (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">No matching units.</p>
              )}
            </div>
          </div>
        )}

        {/* Step 2 — renovation type */}
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

            <TriggerChecklist
              steps={triggerSteps}
              checked={checkedConditions}
              onToggle={toggleCondition}
              selectedTypeName={group?.name ?? null}
            />
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
                        This renovation type has no lines.
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

        {/* Step 4 — target phasing. Shared with the common-area wizard, which
            needs the same step with the same meaning. */}
        {step === 3 && (
          <TargetPhasingStep
            dates={dates}
            setDate={setDate}
            onReset={() => setDates(suggested)}
            suggested={suggested}
            schedule={scheduleSettings}
            noun="the whole turn"
          />
        )}

        {/* Step 5 — create */}
        {step === 4 && (
          <div className="space-y-2 text-sm">
            <Summary label="Unit" value={unit ? `Unit ${unit.unitNumber}` : "—"} />
            <Summary label="Renovation type" value={group?.name ?? "—"} />
            <Summary label="Budget lines" value={String(lines.length)} />
            {SCHEDULE_KEYS.map((key) => {
              const run = key === PRE_WALK_KEY ? null : phaseRun(dates, key as ProjectPhaseKey);
              return (
                <Summary
                  key={key}
                  label={SCHEDULE_LABELS[key]}
                  value={
                    dates[key]
                      ? `${fmtDate(dates[key])}${
                          run && run.days > 0 ? ` · ${describeDays(run.days)}` : ""
                        }`
                      : "—"
                  }
                />
              );
            })}
            <div className="flex items-center justify-between border-t pt-2 font-semibold text-navy">
              <span>Estimated budget</span>
              <span className="tabular-nums">{money(total)}</span>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between border-t pt-3">
          <div className="flex items-center gap-1">
            {/* Step 0 has nowhere to go back to, so Cancel is the way out —
                previously the only exit was the browser's own back button. */}
            <Button
              variant="ghost"
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              disabled={step === 0 || busy}
            >
              Back
            </Button>
            <Button variant="ghost" onClick={requestCancel} disabled={busy}>
              Cancel
            </Button>
          </div>
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

      <Dialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Discard this project?</DialogTitle>
            <DialogDescription>
              {unit
                ? `Unit ${unit.unitNumber} hasn't been created yet. The scope and dates entered here
                   will be lost.`
                : "Nothing has been created yet, but what you have entered here will be lost."}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmCancel(false)}>
              Keep editing
            </Button>
            <Button variant="destructive" onClick={leave}>
              Discard
            </Button>
          </div>
        </DialogContent>
      </Dialog>
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

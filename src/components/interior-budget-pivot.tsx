"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, FileSpreadsheet, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AddUnitRenovationWizard,
  type WizardFloorplan,
} from "@/components/add-unit-renovation-wizard";
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
import { money, moneyExact } from "@/lib/format";
import { PRICING_METHOD_LABELS, type PricingMethod } from "@/lib/pricing";
import { cn } from "@/lib/utils";
import {
  clearOverride,
  removePlanCell,
  upsertOverride,
  upsertPlanCell,
  updateUpliftRates,
} from "@/lib/actions/interior-budget-plan";
import { setTierLinePrice } from "@/lib/actions/budget-groups";
import { updateUnitGroup } from "@/lib/actions/interior-unit-groups";

// Serializable mirrors of src/lib/interior-budget.ts, flattened for the client.
export type PivotUnitGroup = {
  id: number;
  name: string;
  avgSqft: number | null;
  unitCount: number;
  countOverridden: boolean;
  sqftOverridden: boolean;
};
export type PivotTier = { id: number; name: string };
export type PivotRowData = {
  costCodeId: number;
  code: string;
  label: string;
  categoryName: string;
};
export type PivotCellData = {
  unitGroupId: number;
  tierId: number;
  costCodeId: number;
  amount: number;
  quantity: number;
  pricingMethod: PricingMethod;
  /** The tier's own price for this cost code, before derivation or override. */
  tierUnitPrice: number;
  overridden: boolean;
  overrideNote: string | null;
  note?: string;
};
export type PivotColumnData = {
  unitGroupId: number;
  tierId: number;
  scopeTotal: number;
  cm: number;
  contingency: number;
  perUnitTotal: number;
  plannedUnits: number;
  totalCost: number;
  actualUnits: number;
};

export type InteriorPivotProps = {
  propertyId: number;
  unitGroups: PivotUnitGroup[];
  tiers: PivotTier[];
  /** Every tier the property has. `tiers` only holds the ones already planned. */
  availableTiers: PivotTier[];
  rows: PivotRowData[];
  cells: PivotCellData[];
  columns: PivotColumnData[];
  total: number;
  cmPct: number;
  contingencyPct: number;
  unmappedFloorplans: { floorPlanCode: string; unitCount: number }[];
  unattributedProjects: number;
  propertySlug: string;
  /** Columns can only be added from a committed rent roll — drives the empty state. */
  rentRoll: { hasCommitted: boolean; pendingCount: number };
  availableFloorplans: WizardFloorplan[];
};

const cellKey = (unitGroupId: number, tierId: number, costCodeId: number) =>
  `${unitGroupId}:${tierId}:${costCodeId}`;
const colKey = (unitGroupId: number, tierId: number) => `${unitGroupId}:${tierId}`;

/** Sticky first column needs an opaque background of its own to scroll under. */
const STICKY = "sticky left-0 z-20";

export function InteriorBudgetPivot(props: InteriorPivotProps) {
  const {
    propertyId, unitGroups, tiers, availableTiers, rows, cells, columns, total,
    cmPct, contingencyPct, unmappedFloorplans, unattributedProjects,
    propertySlug, rentRoll, availableFloorplans,
  } = props;

  const [showEmpty, setShowEmpty] = useState(false);
  const [ratesOpen, setRatesOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [cellTarget, setCellTarget] = useState<{
    row: PivotRowData;
    cell: PivotCellData;
    groupName: string;
    tierName: string;
    tierUnitPrice: number;
    rowOverrideCount: number;
    columnCount: number;
  } | null>(null);
  const [planTarget, setPlanTarget] = useState<{
    column: PivotColumnData;
    groupName: string;
    tierName: string;
    unitCount: number;
    /** Units of this floorplan already committed to its OTHER renovation types. */
    plannedElsewhere: number;
    group: PivotUnitGroup;
  } | null>(null);

  const cellByKey = useMemo(
    () => new Map(cells.map((c) => [cellKey(c.unitGroupId, c.tierId, c.costCodeId), c])),
    [cells],
  );
  const colByKey = useMemo(
    () => new Map(columns.map((c) => [colKey(c.unitGroupId, c.tierId), c])),
    [columns],
  );

  // Renovation type is the OUTER grouping and floorplan the inner one, so the
  // type header merges across the floorplans it covers. A column exists only
  // where a plan row does. Zero-penetration columns are real and must be
  // renderable (their Signature column is an explicit zero), but hiding them by
  // default keeps the table readable.
  const visibleColumns = useMemo(() => {
    const ordered = tiers.flatMap((t) =>
      unitGroups
        .map((g) => ({ group: g, tier: t, column: colByKey.get(colKey(g.id, t.id)) }))
        .filter((x): x is { group: PivotUnitGroup; tier: PivotTier; column: PivotColumnData } => !!x.column),
    );
    return showEmpty ? ordered : ordered.filter((c) => c.column.plannedUnits > 0);
  }, [unitGroups, tiers, colByKey, showEmpty]);

  const hiddenCount = useMemo(() => columns.filter((c) => c.plannedUnits <= 0).length, [columns]);

  const tierSpans = useMemo(() => {
    const spans: { tier: PivotTier; span: number }[] = [];
    for (const c of visibleColumns) {
      const last = spans[spans.length - 1];
      if (last && last.tier.id === c.tier.id) last.span++;
      else spans.push({ tier: c.tier, span: 1 });
    }
    return spans;
  }, [visibleColumns]);

  /**
   * Floorplans planned past the number of units that actually exist.
   *
   * Only reachable through drift — a committed rent roll shrinking a floorplan
   * under a plan that was legal when written — because `upsertPlanCell` refuses
   * any edit that would create this. Surfaced rather than blocked, so the way back
   * into compliance is to edit the numbers down.
   */
  const overAllocated = useMemo(() => {
    const plannedByGroup = new Map<number, number>();
    for (const c of columns) {
      plannedByGroup.set(c.unitGroupId, (plannedByGroup.get(c.unitGroupId) ?? 0) + c.plannedUnits);
    }
    return unitGroups
      .map((g) => ({ group: g, planned: plannedByGroup.get(g.id) ?? 0 }))
      .filter((x) => x.group.unitCount > 0 && x.planned > x.group.unitCount);
  }, [columns, unitGroups]);

  const rowsByCategory = useMemo(() => {
    const out: { category: string; rows: PivotRowData[] }[] = [];
    for (const r of rows) {
      const last = out[out.length - 1];
      if (last && last.category === r.categoryName) last.rows.push(r);
      else out.push({ category: r.categoryName, rows: [r] });
    }
    return out;
  }, [rows]);

  const isCustomByColumn = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const c of visibleColumns) {
      const k = colKey(c.group.id, c.tier.id);
      map.set(
        k,
        cells.some(
          (cell) =>
            cell.unitGroupId === c.group.id &&
            cell.tierId === c.tier.id &&
            cell.overridden,
        ),
      );
    }
    return map;
  }, [visibleColumns, cells]);

  // Three distinct nothing-yet states, because each has a different way out: get a
  // rent roll, define a renovation type, or put units into one.
  if (!rentRoll.hasCommitted) {
    return <NoRentRollState propertySlug={propertySlug} pendingCount={rentRoll.pendingCount} />;
  }
  if (visibleColumns.length === 0) {
    return (
      <div className="space-y-3">
        <EmptyState
          message={
            availableTiers.length === 0
              ? "No renovation types exist for this property yet. Create one under Unit Upgrades, then add units to it."
              : "Nothing renovated yet. Add a unit renovation to build the budget."
          }
        />
        {availableTiers.length > 0 && (
          <div className="flex justify-center">
            <Button size="sm" onClick={() => setWizardOpen(true)}>
              <Plus className="size-3.5" />
              Add unit renovation
            </Button>
          </div>
        )}
        {hiddenCount > 0 && (
          <ShowEmptyToggle showEmpty={showEmpty} hiddenCount={hiddenCount} onToggle={setShowEmpty} />
        )}
        <AddUnitRenovationWizard
          propertyId={propertyId}
          floorplans={availableFloorplans}
          tiers={availableTiers}
          open={wizardOpen}
          onClose={() => setWizardOpen(false)}
        />
      </div>
    );
  }

  const td = "px-2 py-1.5 text-right tabular-nums whitespace-nowrap";

  return (
    <div className="space-y-3">
      {(unmappedFloorplans.length > 0 || unattributedProjects > 0 || overAllocated.length > 0) && (
        <div className="space-y-1.5">
          {overAllocated.length > 0 && (
            <Warning>
              {overAllocated.length === 1
                ? "1 floorplan plans more renovations than it has units"
                : `${overAllocated.length} floorplans plan more renovations than they have units`}
              , so this budget overstates cost. Reduce the units planned on:{" "}
              <span className="font-medium">
                {overAllocated
                  .slice(0, 6)
                  .map((o) => `${o.group.name} (${o.planned} of ${o.group.unitCount})`)
                  .join(", ")}
                {overAllocated.length > 6 ? "…" : ""}
              </span>
            </Warning>
          )}
          {unmappedFloorplans.length > 0 && (
            <Warning>
              {unmappedFloorplans.length} floorplan{unmappedFloorplans.length === 1 ? "" : "s"} (
              {unmappedFloorplans.reduce((s, f) => s + f.unitCount, 0)} units) are in no unit group and
              are excluded from this budget:{" "}
              <span className="font-medium">
                {unmappedFloorplans.slice(0, 6).map((f) => f.floorPlanCode || "(blank)").join(", ")}
                {unmappedFloorplans.length > 6 ? "…" : ""}
              </span>
            </Warning>
          )}
          {unattributedProjects > 0 && (
            <Warning>
              {unattributedProjects} interior project{unattributedProjects === 1 ? "" : "s"} couldn&apos;t be
              matched to a unit group, so they&apos;re missing from the Started counts.
            </Warning>
          )}
        </div>
      )}

      <div className="overflow-x-auto rounded-md border border-hairline">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="bg-band">
              <th className={cn(STICKY, "bg-band px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-900")}>
                Renovation Type
              </th>
              {tierSpans.map(({ tier, span }) => (
                <th
                  key={tier.id}
                  colSpan={span}
                  className="border-l border-hairline px-2 py-1.5 text-center text-[11px] font-bold uppercase tracking-[0.08em] text-ink-900"
                >
                  {tier.name}
                </th>
              ))}
            </tr>
            <tr className="bg-band">
              <th className={cn(STICKY, "bg-band px-2 pb-1.5 text-left text-[11px] uppercase tracking-[0.08em] text-ink-500")}>
                Floorplan Type
              </th>
              {visibleColumns.map(({ group, tier }) => (
                <th
                  key={colKey(group.id, tier.id)}
                  className="border-l border-hairline px-2 pb-1.5 text-center text-[11px] font-semibold whitespace-nowrap text-ink-700"
                >
                  {group.name}
                  <div className="mt-0.5 text-[10px] font-normal text-ink-500">
                    {group.avgSqft != null ? `${group.avgSqft.toLocaleString()} SF avg` : "no SF on file"}
                    {group.sqftOverridden && " (set)"}
                  </div>
                </th>
              ))}
            </tr>
            <tr className="bg-band">
              <th className={cn(STICKY, "bg-band px-2 pb-1 text-left text-[11px] text-ink-500")} />
              {visibleColumns.map(({ group, tier }) => {
                const custom = isCustomByColumn.get(colKey(group.id, tier.id));
                return (
                  <th key={colKey(group.id, tier.id)} className="border-l border-hairline px-2 pb-1 text-center">
                    <span
                      className={cn(
                        "inline-block rounded-full px-2 py-0.5 text-[10px] font-medium",
                        custom
                          ? "bg-blue-50 text-blue-700 border border-blue-200"
                          : "text-ink-400 border border-hairline",
                      )}
                    >
                      {custom ? "Custom" : "Default"}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {rowsByCategory.map(({ category, rows: catRows }) => (
              <Fragment key={category}>
                <tr className="bg-band/60">
                  <td
                    className={cn(STICKY, "bg-band px-2 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-ink-700")}
                  >
                    {category}
                  </td>
                  <td colSpan={visibleColumns.length} className="bg-band/60" />
                </tr>
                {catRows.map((row) => (
                  <tr key={row.costCodeId} className="border-t border-hairline hover:bg-hover">
                    <td className={cn(STICKY, "bg-card px-2 py-1.5 text-left text-ink-700")}>
                      <span className="block max-w-[22rem] truncate" title={`${row.code} — ${row.label}`}>
                        {row.label}
                      </span>
                    </td>
                    {visibleColumns.map(({ group, tier }) => {
                      const cell = cellByKey.get(cellKey(group.id, tier.id, row.costCodeId));
                      return (
                        <td key={colKey(group.id, tier.id)} className={cn(td, "border-l border-hairline p-0")}>
                          <CellButton
                            cell={cell}
                            onClick={() => {
                              if (!cell) return;
                              setCellTarget({
                                row,
                                cell,
                                groupName: group.name,
                                tierName: tier.name,
                                tierUnitPrice: cell.tierUnitPrice,
                                rowOverrideCount: cells.filter(
                                  (c) =>
                                    c.tierId === tier.id &&
                                    c.costCodeId === row.costCodeId &&
                                    c.overridden,
                                ).length,
                                columnCount: visibleColumns.filter(
                                  (c) => c.tier.id === tier.id,
                                ).length,
                              });
                            }}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>

          <tfoot className="text-[12px]">
            <FooterRow
              label="TOTAL"
              bold
              columns={visibleColumns}
              value={(c) => money(c.scopeTotal)}
            />
            <FooterRow
              label="CM / Supervision"
              labelSuffix={
                <RateButton pct={cmPct} onClick={() => setRatesOpen(true)} />
              }
              columns={visibleColumns}
              value={(c) => money(c.cm)}
            />
            <FooterRow
              label="Contingency"
              labelSuffix={
                <RateButton pct={contingencyPct} onClick={() => setRatesOpen(true)} />
              }
              columns={visibleColumns}
              value={(c) => money(c.contingency)}
            />
            <FooterRow
              label="GRAND TOTAL / unit"
              bold
              band
              columns={visibleColumns}
              value={(c) => money(c.perUnitTotal)}
            />
            <FooterRow
              label="Penetration"
              columns={visibleColumns}
              spacerAbove
              value={(c, group) =>
                group.unitCount > 0
                  ? `${Math.round((c.plannedUnits / group.unitCount) * 1000) / 10}%`
                  : "—"
              }
            />
            <FooterRow
              label="Units planned"
              columns={visibleColumns}
              editable
              onEdit={(c, group, tier) =>
                setPlanTarget({
                  column: c,
                  groupName: group.name,
                  tierName: tier.name,
                  unitCount: group.unitCount,
                  // From `columns`, not `visibleColumns` — a hidden zero-unit column
                  // is still a real allocation.
                  plannedElsewhere: columns
                    .filter((x) => x.unitGroupId === group.id && x.tierId !== tier.id)
                    .reduce((s, x) => s + x.plannedUnits, 0),
                  group,
                })
              }
              value={(c) => c.plannedUnits.toLocaleString()}
            />
            <FooterRow
              label="Started"
              columns={visibleColumns}
              value={(c) => (c.actualUnits > 0 ? c.actualUnits.toLocaleString() : "—")}
            />
            <FooterRow
              label="Total cost"
              bold
              band
              columns={visibleColumns}
              value={(c) => money(c.totalCost)}
            />
            <tr className="border-t-2 border-border-2 bg-band">
              <td className={cn(STICKY, "bg-band px-2 py-2 text-left font-bold text-ink-900")}>
                Interior budget
              </td>
              <td
                colSpan={visibleColumns.length}
                className="px-2 py-2 text-right font-bold tabular-nums text-ink-900"
              >
                {money(total)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] text-ink-500">
          Click any cell to change the default price or set a custom override.
          Cells with a custom amount are highlighted; everything else derives from the
          renovation type&apos;s pricing.
        </p>
        <div className="flex shrink-0 items-center gap-2">
          {hiddenCount > 0 && (
            <ShowEmptyToggle showEmpty={showEmpty} hiddenCount={hiddenCount} onToggle={setShowEmpty} />
          )}
          {availableTiers.length > 0 && (
            <Button size="sm" variant="outline" onClick={() => setWizardOpen(true)}>
              <Plus className="size-3.5" />
              Add units
            </Button>
          )}
        </div>
      </div>

      <CellDialog propertyId={propertyId} target={cellTarget} onClose={() => setCellTarget(null)} />
      <AddUnitRenovationWizard
        propertyId={propertyId}
        floorplans={availableFloorplans}
        tiers={availableTiers}
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
      />
      <RatesDialog
        propertyId={propertyId}
        open={ratesOpen}
        cmPct={cmPct}
        contingencyPct={contingencyPct}
        onClose={() => setRatesOpen(false)}
      />
      <PlanDialog propertyId={propertyId} target={planTarget} onClose={() => setPlanTarget(null)} />
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * Unit count and average SF normally derive from the rent roll and must not be
 * typed in. These overrides exist for pre-acquisition underwriting where there is
 * no rent roll yet — and avg SF is the multiplier for every per-square-foot line,
 * so losing the ability to set it would break that case entirely. Tucked away
 * because reaching for it is almost always a mistake.
 */
function FloorplanOverrides({
  propertyId,
  group,
}: {
  propertyId: number;
  group: PivotUnitGroup;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const numOrUndef = (k: string) => {
      const v = String(fd.get(k) ?? "").trim();
      return v === "" ? undefined : Number(v);
    };
    setBusy(true);
    try {
      const result = await updateUnitGroup({
        id: group.id,
        propertyId,
        name: group.name,
        unitCountOverride: numOrUndef("unitCount"),
        avgSqftOverride: numOrUndef("avgSqft"),
      });
      if (!result.ok) return toast.error(result.error);
      toast.success("Floorplan updated");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="rounded-md border border-hairline">
      <summary className="cursor-pointer px-3 py-2 text-[11px] font-semibold text-ink-700">
        Override {group.name} unit count or size
      </summary>
      <form className="space-y-3 border-t border-hairline px-3 py-3" onSubmit={handleSubmit}>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="fo-count">Unit count</Label>
            <Input
              id="fo-count"
              name="unitCount"
              type="number"
              min="0"
              step="1"
              defaultValue={group.countOverridden ? group.unitCount : ""}
              placeholder={`${group.unitCount} from rent roll`}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fo-sqft">Avg SF</Label>
            <Input
              id="fo-sqft"
              name="avgSqft"
              type="number"
              min="0"
              step="0.01"
              defaultValue={group.sqftOverridden ? (group.avgSqft ?? "") : ""}
              placeholder={group.avgSqft != null ? `${group.avgSqft} from rent roll` : "none on file"}
            />
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Leave blank to keep deriving from the rent roll. Average SF prices every per-square-foot
          line, so an override here changes this floorplan&apos;s whole column.
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

function EmptyState({ message }: { message: string }) {
  return <p className="py-10 text-center text-sm text-muted-foreground">{message}</p>;
}

/**
 * Where the interior budget starts for a property with nothing to draw from.
 *
 * Floorplans come from a COMMITTED rent roll, so a batch sitting in review is a
 * different dead end from no batch at all — one needs finishing, the other needs a
 * file. Both resolve on the rent rolls page, which owns the whole upload → review
 * → commit workflow.
 */
function NoRentRollState({
  propertySlug,
  pendingCount,
}: {
  propertySlug: string;
  pendingCount: number;
}) {
  const pending = pendingCount > 0;
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
      <FileSpreadsheet className="size-7 text-ink-400" />
      <div className="space-y-1">
        <p className="text-sm font-medium text-navy">
          {pending ? "Rent roll not committed yet" : "No rent roll uploaded yet"}
        </p>
        <p className="max-w-sm text-xs text-muted-foreground">
          {pending
            ? `${pendingCount} rent roll${pendingCount === 1 ? "" : "s"} uploaded but not committed. Floorplans come from a committed snapshot — finish the review to renovate units.`
            : "Renovations are planned against the floorplans on a committed rent roll. Upload one to build the interior budget."}
        </p>
      </div>
      <Button
        size="sm"
        render={<Link href={`/properties/${propertySlug}/rent-rolls`} />}
        nativeButton={false}
      >
        {pending ? "Finish rent roll review" : "Upload a rent roll"}
      </Button>
    </div>
  );
}

function Warning({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-hairline bg-alert-bg px-3 py-2 text-xs text-ink-700">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-alert" />
      <span>{children}</span>
    </div>
  );
}

function ShowEmptyToggle({
  showEmpty,
  hiddenCount,
  onToggle,
}: {
  showEmpty: boolean;
  hiddenCount: number;
  onToggle: (v: boolean) => void;
}) {
  return (
    <Button variant="ghost" size="sm" onClick={() => onToggle(!showEmpty)}>
      {showEmpty ? "Hide" : "Show"} {hiddenCount} tier{hiddenCount === 1 ? "" : "s"} with no units planned
    </Button>
  );
}

/** One matrix cell. Blank when the tier has no line for this cost code. */
function CellButton({ cell, onClick }: { cell: PivotCellData | undefined; onClick: () => void }) {
  if (!cell) return <span className="block px-2 py-1.5 text-ink-200">—</span>;

  const basis =
    cell.overridden
      ? `Custom${cell.overrideNote ? ` — ${cell.overrideNote}` : ""}`
      : `${PRICING_METHOD_LABELS[cell.pricingMethod]}${
          cell.quantity !== 1 ? ` · qty ${cell.quantity.toLocaleString()}` : ""
        }`;

  return (
    <button
      type="button"
      onClick={onClick}
      title={`${moneyExact(cell.amount)} · ${basis}${cell.note ? ` · ${cell.note}` : ""}`}
      className={cn(
        "block w-full px-2 py-1.5 text-right tabular-nums transition-colors",
        "hover:bg-blue-50/80",
        cell.overridden ? "bg-blue-50/60 text-ink-700" : "text-ink-500",
        cell.note && !cell.overridden && "text-alert",
      )}
    >
      {money(cell.amount)}
    </button>
  );
}

/** The clickable percentage beside an uplift row's label. */
function RateButton({ pct, onClick }: { pct: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Edit uplift rates"
      className="ml-1.5 rounded border border-hairline px-1 py-px text-[11px] font-medium text-link transition-colors hover:bg-hover"
    >
      {pct}%
    </button>
  );
}

function FooterRow({
  label,
  labelSuffix,
  columns,
  value,
  bold,
  band,
  spacerAbove,
  editable,
  onEdit,
}: {
  label: string;
  labelSuffix?: React.ReactNode;
  columns: { group: PivotUnitGroup; tier: PivotTier; column: PivotColumnData }[];
  value: (c: PivotColumnData, group: PivotUnitGroup, tier: PivotTier) => string;
  bold?: boolean;
  band?: boolean;
  spacerAbove?: boolean;
  editable?: boolean;
  onEdit?: (c: PivotColumnData, group: PivotUnitGroup, tier: PivotTier) => void;
}) {
  const bg = band ? "bg-band" : "bg-card";
  return (
    <tr
      className={cn(
        "border-t border-hairline",
        band && "bg-band",
        spacerAbove && "border-t-2 border-border-2",
      )}
    >
      <td
        className={cn(
          STICKY,
          bg,
          "px-2 py-1.5 text-left",
          bold ? "font-bold text-ink-900" : "text-ink-700",
        )}
      >
        {label}
        {labelSuffix}
      </td>
      {columns.map(({ group, tier, column }) => (
        <td
          key={colKey(group.id, tier.id)}
          className={cn(
            "border-l border-hairline text-right tabular-nums",
            editable ? "p-0" : "px-2 py-1.5",
            bold ? "font-bold text-ink-900" : "text-ink-700",
          )}
        >
          {editable && onEdit ? (
            <button
              type="button"
              onClick={() => onEdit(column, group, tier)}
              className="block w-full px-2 py-1.5 text-right tabular-nums text-link transition-colors hover:bg-hover"
            >
              {value(column, group, tier)}
            </button>
          ) : (
            value(column, group, tier)
          )}
        </td>
      ))}
    </tr>
  );
}

// ---------------------------------------------------------------------------

function CellDialog({
  propertyId,
  target,
  onClose,
}: {
  propertyId: number;
  target: {
    row: PivotRowData;
    cell: PivotCellData;
    groupName: string;
    tierName: string;
    tierUnitPrice: number;
    rowOverrideCount: number;
    columnCount: number;
  } | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState<"tier" | "cell">("tier");

  const key = target ? `${target.cell.tierId}:${target.cell.costCodeId}:${target.cell.unitGroupId}` : "";
  const [lastKey, setLastKey] = useState("");
  if (target && key !== lastKey) {
    setLastKey(key);
    setScope(target.cell.overridden ? "cell" : "tier");
  }

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) {
    setBusy(true);
    try {
      const result = await fn();
      if (!result.ok) return toast.error(result.error ?? "Something went wrong");
      toast.success(ok);
      onClose();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!target) return;
    const fd = new FormData(e.currentTarget);
    const value = Number(fd.get("amount"));

    if (scope === "tier") {
      await run(async () => {
        const r = await setTierLinePrice({
          propertyId,
          budgetGroupId: target.cell.tierId,
          costCodeId: target.cell.costCodeId,
          unitPrice: value,
        });
        if (r.ok && r.overriddenCells > 0) {
          toast.info(
            `${r.overriddenCells} custom override${r.overriddenCells === 1 ? "" : "s"} on this row keep their amounts`,
          );
        }
        return r;
      }, `${target.tierName} default updated`);
      return;
    }

    await run(
      () =>
        upsertOverride({
          propertyId,
          budgetGroupId: target.cell.tierId,
          costCodeId: target.cell.costCodeId,
          unitGroupId: target.cell.unitGroupId,
          amount: value,
          note: String(fd.get("note") ?? "") || undefined,
        }),
      `Custom override saved for ${target.groupName}`,
    );
  }

  const methodLabel = target ? PRICING_METHOD_LABELS[target.cell.pricingMethod] : "";
  const isRate = target ? target.cell.pricingMethod !== "fixed" : false;

  return (
    <Dialog open={target != null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        {target && (
          <>
            <DialogHeader>
              <DialogTitle>{target.row.label}</DialogTitle>
              <DialogDescription>
                {target.tierName} · {target.groupName} · currently{" "}
                {target.cell.overridden ? "custom at " : "default "}
                {moneyExact(target.cell.amount)}
                {!target.cell.overridden && isRate && ` from ${methodLabel.toLowerCase()}`}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2">
              <ScopeChoice
                checked={scope === "tier"}
                onSelect={() => setScope("tier")}
                title={`Change the ${target.tierName} default`}
                detail={
                  target.columnCount > 1
                    ? `Updates this row for all ${target.columnCount} floorplans on this tier.`
                    : "Updates this row wherever this tier is planned."
                }
              />
              <ScopeChoice
                checked={scope === "cell"}
                onSelect={() => setScope("cell")}
                title={`Custom override for ${target.groupName}`}
                detail="A negotiated amount for this cell only. Ignores the default pricing."
              />
            </div>

            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="space-y-1.5">
                <Label htmlFor="cell-amount">
                  {scope === "tier"
                    ? isRate
                      ? `${methodLabel} rate ($)`
                      : "Default price ($)"
                    : "Override amount ($)"}
                </Label>
                <Input
                  id="cell-amount"
                  name="amount"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  key={`${key}:${scope}`}
                  defaultValue={
                    scope === "tier"
                      ? target.tierUnitPrice.toFixed(2)
                      : target.cell.amount.toFixed(2)
                  }
                />
                <p className="text-[11px] text-muted-foreground">
                  {scope === "tier"
                    ? isRate
                      ? `A ${methodLabel.toLowerCase()} rate — each floorplan's cell is this × its own quantity.`
                      : "A flat amount every floorplan on this tier gets."
                    : "A finished total for this cell, not a rate — it is never multiplied by square footage."}
                </p>
              </div>

              {scope === "cell" && (
                <div className="space-y-1.5">
                  <Label htmlFor="cell-note">Reason</Label>
                  <Input
                    id="cell-note"
                    name="note"
                    defaultValue={target.cell.overrideNote ?? ""}
                    placeholder="GC quote 6/12"
                  />
                </div>
              )}

              {scope === "tier" && target.rowOverrideCount > 0 && (
                <p className="rounded border border-hairline bg-alert-bg px-2 py-1.5 text-[11px] text-ink-700">
                  {target.rowOverrideCount} cell{target.rowOverrideCount === 1 ? "" : "s"} on this row{" "}
                  {target.rowOverrideCount === 1 ? "has a" : "have"} custom override{target.rowOverrideCount === 1 ? "" : "s"} and will not change.
                </p>
              )}

              <DialogFooter className="gap-2 sm:justify-between">
                {target.cell.overridden ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      run(
                        () =>
                          clearOverride({
                            propertyId,
                            budgetGroupId: target.cell.tierId,
                            costCodeId: target.cell.costCodeId,
                            unitGroupId: target.cell.unitGroupId,
                          }),
                        "Override removed — cell uses default pricing",
                      )
                    }
                  >
                    Revert to default
                  </Button>
                ) : (
                  <span />
                )}
                <Button type="submit" disabled={busy}>
                  {busy ? "Saving…" : scope === "tier" ? "Update default" : "Save override"}
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The two uplift percentages. Only the rates — which cost codes they post to is a
 * structural setting and stays in the unit-groups panel, because getting it wrong
 * breaks the pivot's reconciliation to the Interiors division.
 */
function RatesDialog({
  propertyId,
  open,
  cmPct,
  contingencyPct,
  onClose,
}: {
  propertyId: number;
  open: boolean;
  cmPct: number;
  contingencyPct: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const result = await updateUpliftRates({
        propertyId,
        cmSupervisionPct: Number(fd.get("cmPct")),
        contingencyPct: Number(fd.get("contingencyPct")),
      });
      if (!result.ok) return toast.error(result.error);
      toast.success("Uplift rates updated");
      onClose();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Uplift rates</DialogTitle>
          <DialogDescription>
            Both apply to the scope subtotal, not to each other — they don&apos;t compound. They inflate
            the budget but never become scope lines on a project.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="rates-cm">CM / supervision (%)</Label>
              <Input
                id="rates-cm"
                name="cmPct"
                type="number"
                min="0"
                max="100"
                step="0.001"
                defaultValue={cmPct}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rates-cont">Contingency (%)</Label>
              <Input
                id="rates-cont"
                name="contingencyPct"
                type="number"
                min="0"
                max="100"
                step="0.001"
                defaultValue={contingencyPct}
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save rates"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ScopeChoice({
  checked,
  onSelect,
  title,
  detail,
}: {
  checked: boolean;
  onSelect: () => void;
  title: string;
  detail: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-2.5 rounded-md border p-2.5 text-left transition-colors",
        checked ? "border-navy bg-muted" : "border-input hover:bg-muted/50",
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-full border",
          checked ? "border-navy" : "border-input",
        )}
      >
        {checked && <span className="size-1.5 rounded-full bg-navy" />}
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-navy">{title}</span>
        <span className="block text-[11px] text-muted-foreground">{detail}</span>
      </span>
    </button>
  );
}

function PlanDialog({
  propertyId,
  target,
  onClose,
}: {
  propertyId: number;
  target: {
    column: PivotColumnData;
    groupName: string;
    tierName: string;
    unitCount: number;
    plannedElsewhere: number;
    group: PivotUnitGroup;
  } | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [units, setUnits] = useState("");

  // Seed the field from the cell each time the dialog opens, rather than falling
  // back to the stored value whenever the box is empty — that made the digits snap
  // back the moment you cleared them, so the number couldn't be retyped.
  const key = target ? `${target.column.unitGroupId}:${target.column.tierId}` : "";
  const [lastKey, setLastKey] = useState("");
  if (target && key !== lastKey) {
    setLastKey(key);
    setUnits(String(target.column.plannedUnits));
  }

  // Units are the only input; penetration is read out of them. A whole count is
  // the real quantity — half a renovated apartment doesn't exist.
  const current = Number(units);
  const valid = units.trim() !== "" && Number.isInteger(current) && current >= 0;

  // Capacity is the floorplan's units MINUS whatever its other renovation types
  // already claim: 30 units in two types on a 49-unit floorplan is legal per cell
  // and impossible in total. A unit count of 0 means no rent-roll basis to check
  // against (pre-acquisition), so it isn't enforced.
  const stored = target?.column.plannedUnits ?? 0;
  const remaining =
    target && target.unitCount > 0 ? target.unitCount - target.plannedElsewhere : null;
  // Only an INCREASE past capacity is refused, so an already-over cell can always
  // be edited back down — rent-roll drift must never lock the number.
  const overCapacity = valid && remaining != null && current > remaining && current > stored;

  const pct =
    target && target.unitCount > 0 && valid
      ? Math.round((current / target.unitCount) * 1000) / 10
      : null;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!target) return;
    setBusy(true);
    try {
      const result = await upsertPlanCell({
        propertyId,
        unitGroupId: target.column.unitGroupId,
        budgetGroupId: target.column.tierId,
        plannedUnits: current,
      });
      if (!result.ok) return toast.error(result.error);
      toast.success("Plan updated");
      onClose();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={target != null}
      onOpenChange={(open) => {
        if (!open) {
          // Clearing lastKey makes the next open re-seed from the cell, so an
          // abandoned edit isn't still sitting there.
          setLastKey("");
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        {target && (
          <>
            <DialogHeader>
              <DialogTitle>
                {target.groupName} · {target.tierName}
              </DialogTitle>
              <DialogDescription>
                How many of this group&apos;s {target.unitCount.toLocaleString()} units get this tier.
              </DialogDescription>
            </DialogHeader>
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="space-y-1.5">
                <Label htmlFor="plan-units">Units</Label>
                <Input
                  id="plan-units"
                  type="number"
                  min="0"
                  max={target.unitCount}
                  step="1"
                  value={units}
                  onChange={(e) => setUnits(e.target.value)}
                />
                <p className={cn("text-[11px]", overCapacity ? "text-alert" : "text-muted-foreground")}>
                  {!valid
                    ? "Enter a whole number of units."
                    : overCapacity
                      ? target.plannedElsewhere > 0
                        ? `Only ${remaining!.toLocaleString()} of this floorplan's ${target.unitCount.toLocaleString()} units are unplanned — ${target.plannedElsewhere.toLocaleString()} are in other renovation types.`
                        : `Only ${target.unitCount.toLocaleString()} units in this floorplan.`
                      : `${pct}% penetration of ${target.unitCount.toLocaleString()} units.` +
                        (target.plannedElsewhere > 0
                          ? ` ${target.plannedElsewhere.toLocaleString()} in other renovation types.`
                          : "")}
                </p>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {target.column.actualUnits > 0
                  ? `${target.column.actualUnits} unit${target.column.actualUnits === 1 ? "" : "s"} already started on this tier.`
                  : "No units started on this tier yet."}
              </p>

              <div className="flex items-center justify-between gap-3">
                {/* The only way to take a floorplan back off the budget now that unit
                    groups aren't user-managed. Drops the column; overrides survive in
                    case the floorplan is added back. */}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const result = await removePlanCell({
                        propertyId,
                        unitGroupId: target.column.unitGroupId,
                        budgetGroupId: target.column.tierId,
                      });
                      if (!result.ok) return toast.error(result.error);
                      toast.success(`Removed ${target.groupName} from ${target.tierName}`);
                      onClose();
                      router.refresh();
                    } finally {
                      setBusy(false);
                    }
                  }}
                  className="text-destructive hover:text-destructive"
                >
                  Remove column
                </Button>
                <Button type="submit" disabled={busy || !valid || overCapacity}>
                  {busy ? "Saving…" : "Save plan"}
                </Button>
              </div>
            </form>

            <FloorplanOverrides propertyId={propertyId} group={target.group} />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

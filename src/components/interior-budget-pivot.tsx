"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, FileSpreadsheet, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { WizardFloorplan } from "@/components/add-unit-renovation-wizard";

const AddUnitRenovationWizard = dynamic(() =>
  import("@/components/add-unit-renovation-wizard").then((m) => m.AddUnitRenovationWizard),
);
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
import { updateTargetTradeOut, updateTierDefaults } from "@/lib/actions/budget-groups";
import { updateUnitGroup } from "@/lib/actions/interior-unit-groups";

export type PivotUnitGroup = {
  id: number;
  name: string;
  avgSqft: number | null;
  unitCount: number;
  countOverridden: boolean;
  sqftOverridden: boolean;
};
export type PivotTier = { id: number; name: string; targetTradeOut?: number | null };
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
  tierUnitPrice: number;
  overridden: boolean;
  overrideNote: string | null;
  overridePricingMethod: PricingMethod | null;
  overrideUnitPrice: number | null;
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
  rentRoll: { hasCommitted: boolean; pendingCount: number };
  availableFloorplans: WizardFloorplan[];
  avgTradeOutByTier?: Record<number, number>;
};

const TIER_PALETTE = [
  { text: "#1b3a6b", bg: "#dde6f5", border: "#c3d3ec", dot: "#4a74c4" },
  { text: "#7a4711", bg: "#f7e7cf", border: "#ecd4ae", dot: "#c9873a" },
] as const;

const cellKey = (unitGroupId: number, tierId: number, costCodeId: number) =>
  `${unitGroupId}:${tierId}:${costCodeId}`;
const colKey = (unitGroupId: number, tierId: number) => `${unitGroupId}:${tierId}`;

export function InteriorBudgetPivot(props: InteriorPivotProps) {
  const {
    propertyId, unitGroups, tiers, availableTiers, rows, cells, columns,
    cmPct, contingencyPct, unmappedFloorplans, unattributedProjects,
    propertySlug, rentRoll, availableFloorplans, avgTradeOutByTier,
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
    plannedElsewhere: number;
    group: PivotUnitGroup;
  } | null>(null);

  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null);
  const [hoveredColKey, setHoveredColKey] = useState<string | null>(null);

  const cellByKey = useMemo(
    () => new Map(cells.map((c) => [cellKey(c.unitGroupId, c.tierId, c.costCodeId), c])),
    [cells],
  );
  const colByKey = useMemo(
    () => new Map(columns.map((c) => [colKey(c.unitGroupId, c.tierId), c])),
    [columns],
  );

  const visibleColumns = useMemo(() => {
    const ordered = tiers.flatMap((t) =>
      unitGroups
        .map((g) => ({ group: g, tier: t, column: colByKey.get(colKey(g.id, t.id)) }))
        .filter((x): x is { group: PivotUnitGroup; tier: PivotTier; column: PivotColumnData } => !!x.column),
    );
    return showEmpty ? ordered : ordered.filter((c) => c.column.plannedUnits > 0);
  }, [unitGroups, tiers, colByKey, showEmpty]);

  const hiddenCount = useMemo(() => columns.filter((c) => c.plannedUnits <= 0).length, [columns]);

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
      map.set(k, cells.some(
        (cell) => cell.unitGroupId === c.group.id && cell.tierId === c.tier.id && cell.overridden,
      ));
    }
    return map;
  }, [visibleColumns, cells]);

  const tierIndexMap = useMemo(
    () => new Map(tiers.map((t, i) => [t.id, i])),
    [tiers],
  );

  const overAllocated = useMemo(() => {
    const plannedByGroup = new Map<number, number>();
    for (const c of columns) {
      plannedByGroup.set(c.unitGroupId, (plannedByGroup.get(c.unitGroupId) ?? 0) + c.plannedUnits);
    }
    return unitGroups
      .map((g) => ({ group: g, planned: plannedByGroup.get(g.id) ?? 0 }))
      .filter((x) => x.group.unitCount > 0 && x.planned > x.group.unitCount);
  }, [columns, unitGroups]);

  const totalPropertyUnits = useMemo(
    () => unitGroups.reduce((s, g) => s + g.unitCount, 0) + unmappedFloorplans.reduce((s, f) => s + f.unitCount, 0),
    [unitGroups, unmappedFloorplans],
  );

  const tierSummary = useMemo(() => {
    const allUnits = columns.reduce((s, c) => s + c.plannedUnits, 0);
    return tiers
      .map((t, idx) => {
        const cols = columns.filter((c) => c.tierId === t.id);
        const units = cols.reduce((s, c) => s + c.plannedUnits, 0);
        const cost = cols.reduce((s, c) => s + c.totalCost, 0);
        const costPerUnit = units > 0 ? cost / units : 0;
        const targetTradeOut = t.targetTradeOut ?? null;
        return {
          tier: t, idx, units, cost, costPerUnit,
          share: allUnits > 0 ? units / allUnits : 0,
          pctOfProperty: totalPropertyUnits > 0 ? units / totalPropertyUnits : 0,
          allUnits,
          targetTradeOut,
          avgTradeOut: avgTradeOutByTier?.[t.id] ?? null,
          roi: targetTradeOut != null && costPerUnit > 0 ? (targetTradeOut * 12) / costPerUnit : null,
        };
      })
      .filter((s) => s.units > 0);
  }, [tiers, columns, avgTradeOutByTier, totalPropertyUnits]);

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

  // Crosshair-aware row renderer for subtotal / rollout rows.
  function valueRow(
    rid: string,
    label: React.ReactNode,
    getValue: (col: PivotColumnData, group: PivotUnitGroup, tier: PivotTier) => string,
    opts?: {
      weight?: "total" | "grand";
      tone?: "quiet" | "accent";
      editable?: boolean;
      onEdit?: (col: PivotColumnData, group: PivotUnitGroup, tier: PivotTier) => void;
      badge?: string;
      onBadgeClick?: () => void;
    },
  ) {
    const { weight, tone, editable, onEdit, badge, onBadgeClick } = opts ?? {};
    const isHovRow = hoveredRowId === rid;
    const baseBg = weight === "grand" ? "#f6f6f2" : weight === "total" ? "#fcfcfa" : "#ffffff";
    const isBold = weight === "total" || weight === "grand";
    const isGrand = weight === "grand";
    const topRule = isBold ? "1px solid #dedeD8" : "none";

    return (
      <tr key={rid}>
        <td
          className="sticky left-0 z-20 w-[208px] min-w-[208px] whitespace-nowrap px-4 text-left"
          style={{
            paddingTop: 9, paddingBottom: 9,
            borderBottom: "1px solid #eeeeea",
            borderTop: topRule,
            background: isHovRow ? "#f7f8fa" : baseBg,
            boxShadow: "8px 0 12px -10px rgba(0,0,0,.18)",
            transition: "background 110ms linear",
            fontWeight: isBold ? 600 : 400,
            fontSize: 13,
            color: isBold ? "#14161a" : "#3a3d44",
            letterSpacing: isGrand ? "0.02em" : undefined,
            textTransform: isGrand ? "uppercase" : undefined,
          }}
        >
          {label}
          {badge && (
            <button
              type="button"
              onClick={onBadgeClick}
              className="ml-2 cursor-pointer font-sans"
              style={{ fontSize: 10, fontWeight: 500, color: "#7d5a12", background: "#f8efdd", padding: "2px 6px", borderRadius: 5 }}
            >
              {badge}
            </button>
          )}
        </td>
        {visibleColumns.map(({ group, tier, column }) => {
          const ck = colKey(group.id, tier.id);
          const isHovCol = hoveredColKey === ck;
          const isInter = isHovRow && isHovCol;
          const isHigh = isHovRow || isHovCol;
          const val = getValue(column, group, tier);
          const cellBg = isInter ? "#ebeef1" : isHigh ? "#f3f5f7" : baseBg;
          return (
            <td
              key={ck}
              className="w-[102px] min-w-[102px] cursor-pointer font-sans"
              style={{
                padding: editable ? 0 : "9px 12px",
                textAlign: "right", fontSize: 12.5,
                fontVariantNumeric: "tabular-nums",
                fontWeight: isBold ? 600 : 400,
                color: tone === "quiet" ? "#6b6d72" : tone === "accent" ? "#1a2440" : "#14161a",
                borderBottom: "1px solid #eeeeea",
                borderLeft: "1px solid #f4f4f1",
                borderTop: topRule,
                background: cellBg,
                transition: "background 110ms linear",
              }}
              onMouseEnter={() => { setHoveredRowId(rid); setHoveredColKey(ck); }}
            >
              {editable && onEdit ? (
                <button type="button" onClick={() => onEdit(column, group, tier)}
                  className="block w-full cursor-pointer px-3 py-[9px] text-right font-sans text-[12.5px] tabular-nums"
                  style={{ color: "#1a2440" }}>
                  {val}
                </button>
              ) : val}
            </td>
          );
        })}
      </tr>
    );
  }

  return (
    <div className="space-y-3.5">
      {(unmappedFloorplans.length > 0 || unattributedProjects > 0 || overAllocated.length > 0) && (
        <div className="space-y-1.5">
          {overAllocated.length > 0 && (
            <Warning>
              {overAllocated.length === 1
                ? "1 floorplan plans more renovations than it has units"
                : `${overAllocated.length} floorplans plan more renovations than they have units`}
              , so this budget overstates cost. Reduce the units planned on:{" "}
              <span className="font-medium">
                {overAllocated.slice(0, 6).map((o) => `${o.group.name} (${o.planned} of ${o.group.unitCount})`).join(", ")}
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

      {/* Card */}
      <div
        className="flex flex-col overflow-hidden rounded-xl border border-[#e3e3de] bg-white"
        style={{ boxShadow: "0 1px 2px rgba(24,24,27,.04), 0 12px 30px -20px rgba(24,24,27,.2)" }}
      >
        {/* Scroll region */}
        <div
          className="overflow-x-auto overflow-y-visible"
          onMouseLeave={() => { setHoveredRowId(null); setHoveredColKey(null); }}
        >
          <table className="w-max min-w-full border-separate" style={{ borderSpacing: 0 }}>
            <thead>
              <tr>
                <th
                  className="sticky left-0 z-30 w-[208px] min-w-[208px] border-b-2 border-b-[#1a2440] bg-white px-4 py-3 text-left align-top"
                  style={{ boxShadow: "8px 0 12px -10px rgba(0,0,0,.28)" }}
                >
                  <span className="text-[10px] font-semibold uppercase tracking-[0.09em] text-[#8b8d93]">
                    Floorplan type
                  </span>
                </th>
                {visibleColumns.map(({ group, tier }) => {
                  const ck = colKey(group.id, tier.id);
                  const custom = isCustomByColumn.get(ck);
                  const tc = TIER_PALETTE[Math.min(tierIndexMap.get(tier.id) ?? 0, TIER_PALETTE.length - 1)];
                  const isHovCol = hoveredColKey === ck;
                  return (
                    <th
                      key={ck}
                      className="w-[102px] min-w-[102px] border-b-2 border-b-[#1a2440] px-3 py-3 text-center align-top"
                      style={{
                        background: isHovCol ? "#f3f5f7" : "#ffffff",
                        boxShadow: isHovCol ? "inset 0 -3px 0 #c8991f" : "none",
                        transition: "background 110ms linear",
                      }}
                    >
                      <span
                        className="inline-block rounded px-[9px] py-0.5 text-[9px] font-bold uppercase tracking-[0.1em]"
                        style={{ color: tc.text, backgroundColor: tc.bg, border: `1px solid ${tc.border}` }}
                      >
                        {tier.name}
                      </span>
                      <div className="mt-[7px] text-[13px] font-semibold tracking-[0.01em] text-[#1a2440]">
                        {group.name}
                      </div>
                      <div className="mt-[3px] whitespace-nowrap font-sans text-[10px] text-[#8b8d93]">
                        {group.avgSqft != null ? `${group.avgSqft.toLocaleString()} SF avg` : "no SF on file"}
                        {group.sqftOverridden && " (set)"}
                      </div>
                      <div className="mt-2">
                        <span className={cn(
                          "inline-block rounded-full px-2 py-0.5 text-[10px] font-medium tracking-[0.03em]",
                          custom ? "bg-[#dcefe2] text-[#1e5c3c]" : "bg-[#f2f2ee] text-[#75777d]",
                        )}>
                          {custom ? "Custom" : "Default"}
                        </span>
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>

            <tbody>
              {rowsByCategory.map(({ category, rows: catRows }) => (
                <Fragment key={category}>
                  <tr>
                    <td
                      colSpan={visibleColumns.length + 1}
                      className="sticky left-0 bg-white px-4 py-[9px] text-[10px] font-bold uppercase tracking-[0.14em] text-[#8b8d93]"
                      style={{ borderTop: "1px solid #e6e6e1", borderBottom: "1px solid #e6e6e1" }}
                    >
                      {category}
                    </td>
                  </tr>
                  {catRows.map((row) => {
                    const rid = `r-${row.costCodeId}`;
                    const isHovRow = hoveredRowId === rid;
                    return (
                      <tr key={row.costCodeId}>
                        <td
                          className="sticky left-0 z-20 w-[208px] min-w-[208px] whitespace-nowrap px-4 text-left text-[13px] text-[#3a3d44]"
                          style={{
                            paddingTop: 9, paddingBottom: 9,
                            borderBottom: "1px solid #eeeeea",
                            background: isHovRow ? "#f7f8fa" : "#ffffff",
                            boxShadow: "8px 0 12px -10px rgba(0,0,0,.18)",
                            transition: "background 110ms linear",
                          }}
                        >
                          <span className="block max-w-[180px] truncate" title={`${row.code} — ${row.label}`}>
                            {row.label}
                          </span>
                        </td>
                        {visibleColumns.map(({ group, tier }) => {
                          const ck = colKey(group.id, tier.id);
                          const cell = cellByKey.get(cellKey(group.id, tier.id, row.costCodeId));
                          const isHovCol = hoveredColKey === ck;
                          const isInter = isHovRow && isHovCol;
                          const isHigh = isHovRow || isHovCol;
                          return (
                            <td
                              key={ck}
                              className="w-[102px] min-w-[102px] cursor-pointer p-0"
                              style={{
                                borderBottom: "1px solid #eeeeea",
                                borderLeft: "1px solid #f4f4f1",
                                background: isInter ? "#ebeef1" : isHigh ? "#f3f5f7" : "#ffffff",
                                transition: "background 110ms linear",
                              }}
                              onMouseEnter={() => { setHoveredRowId(rid); setHoveredColKey(ck); }}
                            >
                              <CellButton
                                cell={cell}
                                onClick={() => {
                                  const effective: PivotCellData = cell ?? {
                                    unitGroupId: group.id,
                                    tierId: tier.id,
                                    costCodeId: row.costCodeId,
                                    amount: 0,
                                    quantity: 1,
                                    pricingMethod: "fixed" as PricingMethod,
                                    tierUnitPrice: 0,
                                    overridden: false,
                                    overrideNote: null,
                                    overridePricingMethod: null,
                                    overrideUnitPrice: null,
                                  };
                                  setCellTarget({
                                    row, cell: effective,
                                    groupName: group.name,
                                    tierName: tier.name,
                                    tierUnitPrice: effective.tierUnitPrice,
                                    rowOverrideCount: cells.filter(
                                      (c) => c.tierId === tier.id && c.costCodeId === row.costCodeId && c.overridden,
                                    ).length,
                                    columnCount: visibleColumns.filter((c) => c.tier.id === tier.id).length,
                                  });
                                }}
                              />
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </Fragment>
              ))}

              {/* Subtotal rows */}
              {valueRow("total", "Total", (c) => money(c.scopeTotal), { weight: "total" })}
              {valueRow("cm", "CM / Supervision", (c) => money(c.cm), {
                badge: `${cmPct}%`, onBadgeClick: () => setRatesOpen(true),
              })}
              {valueRow("contingency", "Contingency", (c) => money(c.contingency), {
                badge: `${contingencyPct}%`, onBadgeClick: () => setRatesOpen(true),
              })}
              {valueRow("grand", "Grand total / unit", (c) => money(c.perUnitTotal), { weight: "grand" })}

              {/* Unit economics section */}
              <tr>
                <td
                  colSpan={visibleColumns.length + 1}
                  className="sticky left-0 bg-white px-4 py-[9px] text-[10px] font-bold uppercase tracking-[0.14em] text-[#8b8d93]"
                  style={{ borderTop: "1px solid #e6e6e1", borderBottom: "1px solid #e6e6e1" }}
                >
                  Unit Economics
                </td>
              </tr>
              {valueRow("planned", "Units budgeted", (c) => c.plannedUnits.toLocaleString(), {
                tone: "accent", editable: true,
                onEdit: (c, group, tier) => setPlanTarget({
                  column: c, groupName: group.name, tierName: tier.name, unitCount: group.unitCount,
                  plannedElsewhere: columns.filter((x) => x.unitGroupId === group.id && x.tierId !== tier.id).reduce((s, x) => s + x.plannedUnits, 0),
                  group,
                }),
              })}
              {valueRow("pen", "% of total units", (c, group) =>
                group.unitCount > 0 ? `${Math.round((c.plannedUnits / group.unitCount) * 1000) / 10}%` : "—",
                { tone: "quiet" },
              )}
              {valueRow("tradeout", "Projected trade out", (c, group, tier) =>
                tier.targetTradeOut != null ? money(tier.targetTradeOut) : "—",
                { tone: "quiet" },
              )}
              {valueRow("costperunit", "Total cost / unit", (c) =>
                c.plannedUnits > 0 ? money(c.totalCost / c.plannedUnits) : "—",
              )}
              {valueRow("roi", "Projected ROI", (c, group, tier) => {
                if (c.plannedUnits <= 0 || !tier.targetTradeOut) return "—";
                const costPerUnit = c.totalCost / c.plannedUnits;
                if (costPerUnit <= 0) return "—";
                return `${Math.round((tier.targetTradeOut * 12 / costPerUnit) * 1000) / 10}%`;
              }, { weight: "grand" })}
            </tbody>
          </table>
        </div>

        {/* Summary footer */}
        <SummaryFooter propertyId={propertyId} tierSummary={tierSummary} totalPropertyUnits={totalPropertyUnits} />
      </div>

      {/* Help text + actions */}
      <div className="flex items-center justify-between gap-3">
        <p className="max-w-[720px] text-[12px] leading-relaxed text-[#6b6d72]">
          Click any cell to change the default price or set a custom override.
          Cells with a custom amount are highlighted; everything else derives from the
          renovation type&apos;s pricing.
        </p>
        {hiddenCount > 0 && (
          <ShowEmptyToggle showEmpty={showEmpty} hiddenCount={hiddenCount} onToggle={setShowEmpty} />
        )}
      </div>

      <CellDialog propertyId={propertyId} target={cellTarget} onClose={() => setCellTarget(null)} />
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
// Summary footer — extracted for clarity since it now has editable trade-out inputs
// ---------------------------------------------------------------------------

type TierSummaryRow = {
  tier: PivotTier;
  idx: number;
  units: number;
  cost: number;
  costPerUnit: number;
  share: number;
  pctOfProperty: number;
  allUnits: number;
  targetTradeOut: number | null;
  avgTradeOut: number | null;
  roi: number | null;
};

function SummaryFooter({ propertyId, tierSummary, totalPropertyUnits }: { propertyId: number; tierSummary: TierSummaryRow[]; totalPropertyUnits: number }) {
  const router = useRouter();
  const COLS = "minmax(130px, 1.3fr) repeat(5, minmax(90px, 1fr))";
  const HEADERS = ["Renovation type", "Units budgeted", "% of total property", "Projected trade out", "Projected cost / unit", "Projected ROI"];
  const hdrCls = "text-[10px] font-semibold uppercase tracking-[0.09em] text-[#8b8d93] leading-tight";
  const cellCls = "py-[9px] text-right font-sans text-[12.5px] tabular-nums text-[#1a2440]";
  const mutedCls = "py-[9px] text-right font-sans text-[12.5px] tabular-nums text-[#8b8d93]";
  const topBorder = { borderTop: "1px solid #dedeD8" };

  async function saveTradeOut(tierId: number, value: string) {
    const n = value.trim() === "" ? null : Math.round(Number(value));
    if (n != null && Number.isNaN(n)) return;
    const result = await updateTargetTradeOut({ id: tierId, propertyId, targetTradeOut: n });
    if (!result.ok) toast.error("Failed to save");
    else router.refresh();
  }

  const tu = tierSummary.reduce((a, s) => a + s.units, 0);
  const tc = tierSummary.reduce((a, s) => a + s.cost, 0);
  const waCost = tu > 0 ? tc / tu : 0;
  const waTarget = tu > 0
    ? tierSummary.reduce((a, s) => a + (s.targetTradeOut ?? 0) * s.units, 0) / tu
    : 0;
  const waPctOfProperty = totalPropertyUnits > 0 ? tu / totalPropertyUnits : 0;
  const waRoi = waCost > 0 && waTarget > 0 ? (waTarget * 12) / waCost : null;

  return (
    <div
      className="flex flex-col gap-3 px-[18px] pt-4 pb-[18px]"
      style={{ background: "#fbfbf8", borderTop: "1px solid #dedeD8" }}
    >
      <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#8b8d93]">
        Summary by renovation type
      </div>
      <div className="grid items-center" style={{ gridTemplateColumns: COLS, columnGap: 18 }}>
        {HEADERS.map((h, i) => (
          <div
            key={h}
            className={hdrCls}
            style={{ paddingBottom: 8, borderBottom: "1px solid #dedeD8", textAlign: i === 0 ? "left" : "right" }}
          >
            {h}
          </div>
        ))}
        {tierSummary.map((s) => {
          const dot = TIER_PALETTE[Math.min(s.idx, TIER_PALETTE.length - 1)].dot;
          return (
            <Fragment key={s.tier.id}>
              <div className="flex items-center gap-2 py-[9px] text-[12.5px] text-[#1a2440]">
                <span className="inline-block size-[7px] shrink-0 rounded-sm" style={{ background: dot }} />
                {s.tier.name}
              </div>
              <div className={cellCls}>{s.units.toLocaleString()}</div>
              <div className={mutedCls}>{Math.round(s.pctOfProperty * 100)}%</div>
              <div className="flex items-center justify-end gap-0.5 py-[9px]">
                <span className="text-[12px] text-[#8b8d93]">$</span>
                <input
                  type="text"
                  inputMode="numeric"
                  defaultValue={s.targetTradeOut != null ? Math.round(s.targetTradeOut).toLocaleString() : ""}
                  placeholder="—"
                  className="w-[72px] border-0 bg-transparent py-0.5 text-right font-sans text-[12.5px] tabular-nums text-[#1a2440] outline-none focus:border-b focus:border-[#4a74c4]"
                  onBlur={(e) => saveTradeOut(s.tier.id, e.target.value.replace(/,/g, ""))}
                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                />
              </div>
              <div className={cellCls}>{money(Math.round(s.costPerUnit))}</div>
              <div className={mutedCls}>{s.roi != null ? `${Math.round(s.roi * 1000) / 10}%` : "—"}</div>
            </Fragment>
          );
        })}
        {/* Total row */}
        <div className="py-[9px] text-[12.5px] font-semibold text-[#1a2440]" style={topBorder}>Total</div>
        <div className={cn(cellCls, "font-semibold")} style={topBorder}>{tu.toLocaleString()}</div>
        <div className={mutedCls} style={topBorder}>{Math.round(waPctOfProperty * 100)}%</div>
        <div className={cn(cellCls, "font-semibold")} style={topBorder}>{waTarget ? money(Math.round(waTarget)) : "—"}</div>
        <div className={cn(cellCls, "font-semibold")} style={topBorder}>{money(Math.round(waCost))}</div>
        <div className={mutedCls} style={topBorder}>{waRoi != null ? `${Math.round(waRoi * 1000) / 10}%` : "—"}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function FloorplanOverrides({ propertyId, group }: { propertyId: number; group: PivotUnitGroup }) {
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
        id: group.id, propertyId, name: group.name,
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
            <Input id="fo-count" name="unitCount" type="number" min="0" step="1"
              defaultValue={group.countOverridden ? group.unitCount : ""}
              placeholder={`${group.unitCount} from rent roll`} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fo-sqft">Avg SF</Label>
            <Input id="fo-sqft" name="avgSqft" type="number" min="0" step="0.01"
              defaultValue={group.sqftOverridden ? (group.avgSqft ?? "") : ""}
              placeholder={group.avgSqft != null ? `${group.avgSqft} from rent roll` : "none on file"} />
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Leave blank to keep deriving from the rent roll. Average SF prices every per-square-foot
          line, so an override here changes this floorplan&apos;s whole column.
        </p>
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={busy}>Save</Button>
        </div>
      </form>
    </details>
  );
}

function EmptyState({ message }: { message: string }) {
  return <p className="py-10 text-center text-sm text-muted-foreground">{message}</p>;
}

function NoRentRollState({ propertySlug, pendingCount }: { propertySlug: string; pendingCount: number }) {
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
      <Button size="sm" render={<Link href={`/properties/${propertySlug}/rent-rolls`} />} nativeButton={false}>
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

function ShowEmptyToggle({ showEmpty, hiddenCount, onToggle }: { showEmpty: boolean; hiddenCount: number; onToggle: (v: boolean) => void }) {
  return (
    <Button variant="ghost" size="sm" onClick={() => onToggle(!showEmpty)}>
      {showEmpty ? "Hide" : "Show"} {hiddenCount} tier{hiddenCount === 1 ? "" : "s"} with no units planned
    </Button>
  );
}

function CellButton({ cell, onClick }: { cell: PivotCellData | undefined; onClick: () => void }) {
  if (!cell)
    return (
      <button
        type="button"
        onClick={onClick}
        title="No price set — click to add"
        className="block w-full cursor-pointer px-3 py-[9px] text-right text-[12px]"
        style={{ color: "#c6c7c9" }}
      >
        —
      </button>
    );

  const basis = cell.overridden
    ? `Custom${cell.overrideNote ? ` — ${cell.overrideNote}` : ""}`
    : `${PRICING_METHOD_LABELS[cell.pricingMethod]}${cell.quantity !== 1 ? ` · qty ${cell.quantity.toLocaleString()}` : ""}`;

  return (
    <button
      type="button"
      onClick={onClick}
      title={`${moneyExact(cell.amount)} · ${basis}${cell.note ? ` · ${cell.note}` : ""}`}
      className="block w-full cursor-pointer px-3 py-[9px] text-right font-sans tabular-nums"
      style={{
        fontSize: 12.5,
        fontWeight: cell.overridden ? 600 : 400,
        color: cell.overridden ? "#2c7a52" : cell.note ? "#b23b3b" : "#14161a",
      }}
    >
      {money(cell.amount)}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Dialogs (unchanged logic)
// ---------------------------------------------------------------------------

function CellDialog({
  propertyId, target, onClose,
}: {
  propertyId: number;
  target: {
    row: PivotRowData; cell: PivotCellData; groupName: string; tierName: string;
    tierUnitPrice: number; rowOverrideCount: number; columnCount: number;
  } | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState<"tier" | "cell">("tier");
  const [method, setMethod] = useState<"fixed" | "sqft">("fixed");

  const key = target ? `${target.cell.tierId}:${target.cell.costCodeId}:${target.cell.unitGroupId}` : "";
  const [lastKey, setLastKey] = useState("");
  if (target && key !== lastKey) {
    setLastKey(key);
    const isOverridden = target.cell.overridden;
    setScope(isOverridden ? "cell" : "tier");
    const m = isOverridden ? (target.cell.overridePricingMethod ?? "fixed") : target.cell.pricingMethod;
    setMethod(m === "fixed" || m === "sqft" ? m : "fixed");
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
        const r = await updateTierDefaults({
          propertyId, budgetGroupId: target.cell.tierId,
          lines: [{ costCodeId: target.cell.costCodeId, pricingMethod: method, unitPrice: value }],
        });
        if (r.ok && r.overriddenCells > 0) {
          toast.info(`${r.overriddenCells} custom override${r.overriddenCells === 1 ? "" : "s"} on this row keep their amounts`);
        }
        return r;
      }, `${target.tierName} default updated`);
      return;
    }

    await run(
      () => upsertOverride({
        propertyId, budgetGroupId: target.cell.tierId, costCodeId: target.cell.costCodeId,
        unitGroupId: target.cell.unitGroupId, pricingMethod: method, amount: value,
        note: String(fd.get("note") ?? "") || undefined,
      }),
      `Custom override saved for ${target.groupName}`,
    );
  }

  const activeMethod = method;
  const methodLabel = PRICING_METHOD_LABELS[activeMethod] ?? "";
  const isRate = activeMethod !== "fixed";

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
                {target.cell.overridden && target.cell.overridePricingMethod === "sqft" && " from per square foot"}
                {!target.cell.overridden && target.cell.pricingMethod !== "fixed" && ` from ${PRICING_METHOD_LABELS[target.cell.pricingMethod]?.toLowerCase()}`}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2">
              <ScopeChoice checked={scope === "tier"} onSelect={() => setScope("tier")}
                title={`Change the ${target.tierName} default`}
                detail={target.columnCount > 1 ? `Updates this row for all ${target.columnCount} floorplans on this tier.` : "Updates this row wherever this tier is planned."} />
              <ScopeChoice checked={scope === "cell"} onSelect={() => setScope("cell")}
                title={`Custom override for ${target.groupName}`}
                detail="A negotiated amount for this cell only. Ignores the default pricing." />
            </div>

            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="space-y-1.5">
                <Label htmlFor="cell-basis">Basis</Label>
                <select id="cell-basis" value={method} onChange={(e) => setMethod(e.target.value as "fixed" | "sqft")}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                  <option value="fixed">Whole dollars</option>
                  <option value="sqft">Per square foot</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cell-amount">
                  {isRate
                    ? `${methodLabel} rate ($)`
                    : scope === "tier" ? "Default price ($)" : "Override amount ($)"}
                </Label>
                <Input id="cell-amount" name="amount" type="number" min="0" step="0.01" required
                  key={`${key}:${scope}:${method}`}
                  defaultValue={scope === "tier"
                    ? target.tierUnitPrice.toFixed(2)
                    : (target.cell.overrideUnitPrice ?? target.cell.amount).toFixed(2)} />
                <p className="text-[11px] text-muted-foreground">
                  {scope === "tier"
                    ? isRate ? `A ${methodLabel.toLowerCase()} rate — each floorplan's cell is this × its own quantity.` : "A flat amount every floorplan on this tier gets."
                    : isRate ? `A ${methodLabel.toLowerCase()} rate for this cell only — multiplied by this floorplan's square footage.` : "A flat override for this cell only."}
                </p>
              </div>

              {scope === "cell" && (
                <div className="space-y-1.5">
                  <Label htmlFor="cell-note">Reason</Label>
                  <Input id="cell-note" name="note" defaultValue={target.cell.overrideNote ?? ""} placeholder="GC quote 6/12" />
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
                  <Button type="button" variant="outline" size="sm" disabled={busy}
                    onClick={() => run(
                      () => clearOverride({ propertyId, budgetGroupId: target.cell.tierId, costCodeId: target.cell.costCodeId, unitGroupId: target.cell.unitGroupId }),
                      "Override removed — cell uses default pricing",
                    )}>
                    Revert to default
                  </Button>
                ) : <span />}
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

function RatesDialog({ propertyId, open, cmPct, contingencyPct, onClose }: {
  propertyId: number; open: boolean; cmPct: number; contingencyPct: number; onClose: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const result = await updateUpliftRates({ propertyId, cmSupervisionPct: Number(fd.get("cmPct")), contingencyPct: Number(fd.get("contingencyPct")) });
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
              <Input id="rates-cm" name="cmPct" type="number" min="0" max="100" step="0.001" defaultValue={cmPct} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rates-cont">Contingency (%)</Label>
              <Input id="rates-cont" name="contingencyPct" type="number" min="0" max="100" step="0.001" defaultValue={contingencyPct} />
            </div>
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save rates"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ScopeChoice({ checked, onSelect, title, detail }: { checked: boolean; onSelect: () => void; title: string; detail: string }) {
  return (
    <button type="button" onClick={onSelect}
      className={cn("flex w-full items-start gap-2.5 rounded-md border p-2.5 text-left transition-colors", checked ? "border-navy bg-muted" : "border-input hover:bg-muted/50")}>
      <span className={cn("mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-full border", checked ? "border-navy" : "border-input")}>
        {checked && <span className="size-1.5 rounded-full bg-navy" />}
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-navy">{title}</span>
        <span className="block text-[11px] text-muted-foreground">{detail}</span>
      </span>
    </button>
  );
}

function PlanDialog({ propertyId, target, onClose }: {
  propertyId: number;
  target: { column: PivotColumnData; groupName: string; tierName: string; unitCount: number; plannedElsewhere: number; group: PivotUnitGroup } | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [units, setUnits] = useState("");

  const key = target ? `${target.column.unitGroupId}:${target.column.tierId}` : "";
  const [lastKey, setLastKey] = useState("");
  if (target && key !== lastKey) { setLastKey(key); setUnits(String(target.column.plannedUnits)); }

  const current = Number(units);
  const valid = units.trim() !== "" && Number.isInteger(current) && current >= 0;
  const stored = target?.column.plannedUnits ?? 0;
  const remaining = target && target.unitCount > 0 ? target.unitCount - target.plannedElsewhere : null;
  const overCapacity = valid && remaining != null && current > remaining && current > stored;
  const pct = target && target.unitCount > 0 && valid ? Math.round((current / target.unitCount) * 1000) / 10 : null;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!target) return;
    setBusy(true);
    try {
      const result = await upsertPlanCell({ propertyId, unitGroupId: target.column.unitGroupId, budgetGroupId: target.column.tierId, plannedUnits: current });
      if (!result.ok) return toast.error(result.error);
      toast.success("Plan updated");
      onClose();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={target != null} onOpenChange={(open) => { if (!open) { setLastKey(""); onClose(); } }}>
      <DialogContent className="sm:max-w-md">
        {target && (
          <>
            <DialogHeader>
              <DialogTitle>{target.groupName} · {target.tierName}</DialogTitle>
              <DialogDescription>
                How many of this group&apos;s {target.unitCount.toLocaleString()} units get this tier.
              </DialogDescription>
            </DialogHeader>
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="space-y-1.5">
                <Label htmlFor="plan-units">Units</Label>
                <Input id="plan-units" type="number" min="0" max={target.unitCount} step="1" value={units} onChange={(e) => setUnits(e.target.value)} />
                <p className={cn("text-[11px]", overCapacity ? "text-alert" : "text-muted-foreground")}>
                  {!valid ? "Enter a whole number of units."
                    : overCapacity
                      ? target.plannedElsewhere > 0
                        ? `Only ${remaining!.toLocaleString()} of this floorplan's ${target.unitCount.toLocaleString()} units are unplanned — ${target.plannedElsewhere.toLocaleString()} are in other renovation types.`
                        : `Only ${target.unitCount.toLocaleString()} units in this floorplan.`
                      : `${pct}% penetration of ${target.unitCount.toLocaleString()} units.` + (target.plannedElsewhere > 0 ? ` ${target.plannedElsewhere.toLocaleString()} in other renovation types.` : "")}
                </p>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {target.column.actualUnits > 0
                  ? `${target.column.actualUnits} unit${target.column.actualUnits === 1 ? "" : "s"} already started on this tier.`
                  : "No units started on this tier yet."}
              </p>
              <div className="flex items-center justify-between gap-3">
                <Button type="button" variant="ghost" size="sm" disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const result = await removePlanCell({ propertyId, unitGroupId: target.column.unitGroupId, budgetGroupId: target.column.tierId });
                      if (!result.ok) return toast.error(result.error);
                      toast.success(`Removed ${target.groupName} from ${target.tierName}`);
                      onClose(); router.refresh();
                    } finally { setBusy(false); }
                  }}
                  className="text-destructive hover:text-destructive">
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

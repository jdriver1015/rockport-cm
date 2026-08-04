"use client";

import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Pin } from "lucide-react";
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
import { money, moneyExact } from "@/lib/format";
import { PRICING_METHOD_LABELS, type PricingMethod } from "@/lib/pricing";
import { cn } from "@/lib/utils";
import { clearPin, upsertPin, upsertPlanCell, updateUpliftRates } from "@/lib/actions/interior-budget-plan";
import { setTierLinePrice } from "@/lib/actions/budget-groups";

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
  /** The tier's own price for this cost code, before derivation or pinning. */
  tierUnitPrice: number;
  pinned: boolean;
  pinNote: string | null;
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
  rows: PivotRowData[];
  cells: PivotCellData[];
  columns: PivotColumnData[];
  total: number;
  cmPct: number;
  contingencyPct: number;
  unmappedFloorplans: { floorPlanCode: string; unitCount: number }[];
  unattributedProjects: number;
};

const cellKey = (unitGroupId: number, tierId: number, costCodeId: number) =>
  `${unitGroupId}:${tierId}:${costCodeId}`;
const colKey = (unitGroupId: number, tierId: number) => `${unitGroupId}:${tierId}`;

/** Sticky first column needs an opaque background of its own to scroll under. */
const STICKY = "sticky left-0 z-20";

export function InteriorBudgetPivot(props: InteriorPivotProps) {
  const {
    propertyId, unitGroups, tiers, rows, cells, columns, total,
    cmPct, contingencyPct, unmappedFloorplans, unattributedProjects,
  } = props;

  const [showEmpty, setShowEmpty] = useState(false);
  const [ratesOpen, setRatesOpen] = useState(false);
  const [cellTarget, setCellTarget] = useState<{
    row: PivotRowData;
    cell: PivotCellData;
    groupName: string;
    tierName: string;
    tierUnitPrice: number;
    rowPinCount: number;
    columnCount: number;
  } | null>(null);
  const [planTarget, setPlanTarget] = useState<{
    column: PivotColumnData;
    groupName: string;
    tierName: string;
    unitCount: number;
  } | null>(null);

  const cellByKey = useMemo(
    () => new Map(cells.map((c) => [cellKey(c.unitGroupId, c.tierId, c.costCodeId), c])),
    [cells],
  );
  const colByKey = useMemo(
    () => new Map(columns.map((c) => [colKey(c.unitGroupId, c.tierId), c])),
    [columns],
  );

  // A column exists only where a plan row does. Zero-penetration columns are
  // real and must be renderable (their Signature column is an explicit zero),
  // but hiding them by default keeps the table readable.
  const visibleColumns = useMemo(() => {
    const ordered = unitGroups.flatMap((g) =>
      tiers
        .map((t) => ({ group: g, tier: t, column: colByKey.get(colKey(g.id, t.id)) }))
        .filter((x): x is { group: PivotUnitGroup; tier: PivotTier; column: PivotColumnData } => !!x.column),
    );
    return showEmpty ? ordered : ordered.filter((c) => c.column.plannedUnits > 0);
  }, [unitGroups, tiers, colByKey, showEmpty]);

  const hiddenCount = useMemo(() => columns.filter((c) => c.plannedUnits <= 0).length, [columns]);

  const groupSpans = useMemo(() => {
    const spans: { group: PivotUnitGroup; span: number }[] = [];
    for (const c of visibleColumns) {
      const last = spans[spans.length - 1];
      if (last && last.group.id === c.group.id) last.span++;
      else spans.push({ group: c.group, span: 1 });
    }
    return spans;
  }, [visibleColumns]);

  const rowsByCategory = useMemo(() => {
    const out: { category: string; rows: PivotRowData[] }[] = [];
    for (const r of rows) {
      const last = out[out.length - 1];
      if (last && last.category === r.categoryName) last.rows.push(r);
      else out.push({ category: r.categoryName, rows: [r] });
    }
    return out;
  }, [rows]);

  if (unitGroups.length === 0) {
    return (
      <EmptyState message="No unit groups yet. Seed them from a committed rent roll to build the interior budget." />
    );
  }
  if (visibleColumns.length === 0) {
    return (
      <div className="space-y-3">
        <EmptyState message="No upgrade tiers are planned for any unit group yet. Plan units into a tier to build the budget." />
        {hiddenCount > 0 && (
          <ShowEmptyToggle showEmpty={showEmpty} hiddenCount={hiddenCount} onToggle={setShowEmpty} />
        )}
      </div>
    );
  }

  const th = "px-2 py-1.5 text-right text-[11px] font-semibold whitespace-nowrap";
  const td = "px-2 py-1.5 text-right tabular-nums whitespace-nowrap";

  return (
    <div className="space-y-3">
      {(unmappedFloorplans.length > 0 || unattributedProjects > 0) && (
        <div className="space-y-1.5">
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
                Item
              </th>
              {groupSpans.map(({ group, span }) => (
                <th
                  key={group.id}
                  colSpan={span}
                  className="border-l border-hairline px-2 py-1.5 text-center text-[11px] font-bold uppercase tracking-[0.08em] text-ink-900"
                >
                  {group.name}
                  <div className="mt-0.5 text-[10px] font-normal normal-case tracking-normal text-ink-500">
                    {group.avgSqft != null ? `${group.avgSqft.toLocaleString()} SF avg` : "no SF on file"}
                    {group.sqftOverridden && " (set)"} · {group.unitCount.toLocaleString()} units
                    {group.countOverridden && " (set)"}
                  </div>
                </th>
              ))}
            </tr>
            <tr className="bg-band">
              <th className={cn(STICKY, "bg-band px-2 pb-1.5 text-left text-[11px] text-ink-500")}>
                Cost code
              </th>
              {visibleColumns.map(({ group, tier }) => (
                <th key={colKey(group.id, tier.id)} className={cn(th, "border-l border-hairline text-ink-700")}>
                  {tier.name}
                </th>
              ))}
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
                                // How many cells on this row are pinned, so the
                                // dialog can warn that a tier price change won't
                                // move them.
                                rowPinCount: cells.filter(
                                  (c) =>
                                    c.tierId === tier.id &&
                                    c.costCodeId === row.costCodeId &&
                                    c.pinned,
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
              value={(c) => moneyExact(c.scopeTotal)}
            />
            <FooterRow
              label="CM / Supervision"
              labelSuffix={
                <RateButton pct={cmPct} onClick={() => setRatesOpen(true)} />
              }
              columns={visibleColumns}
              value={(c) => moneyExact(c.cm)}
            />
            <FooterRow
              label="Contingency"
              labelSuffix={
                <RateButton pct={contingencyPct} onClick={() => setRatesOpen(true)} />
              }
              columns={visibleColumns}
              value={(c) => moneyExact(c.contingency)}
            />
            <FooterRow
              label="GRAND TOTAL / unit"
              bold
              band
              columns={visibleColumns}
              value={(c) => moneyExact(c.perUnitTotal)}
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
                {moneyExact(total)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] text-ink-500">
          Click any cell to change that tier&apos;s price for the row, or to pin a negotiated amount for
          one unit group. Pinned cells show{" "}
          <Pin className="inline size-3 -translate-y-px text-link" /> and ignore the pricing method.
          Everything else derives from the tier&apos;s pricing against the group&apos;s average SF.
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

function EmptyState({ message }: { message: string }) {
  return <p className="py-10 text-center text-sm text-muted-foreground">{message}</p>;
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
    cell.pinned
      ? `Pinned${cell.pinNote ? ` — ${cell.pinNote}` : ""}`
      : `${PRICING_METHOD_LABELS[cell.pricingMethod]}${
          cell.quantity !== 1 ? ` · qty ${cell.quantity.toLocaleString()}` : ""
        }`;

  return (
    <button
      type="button"
      onClick={onClick}
      title={`${moneyExact(cell.amount)} · ${basis}${cell.note ? ` · ${cell.note}` : ""}`}
      className={cn(
        "block w-full px-2 py-1.5 text-right tabular-nums transition-colors hover:bg-hover",
        // Blue for a pinned value, mirroring a financial model's input convention.
        cell.pinned ? "font-semibold text-link" : "text-ink-500",
        cell.note && !cell.pinned && "text-alert",
      )}
    >
      {money(cell.amount)}
      {cell.pinned && <Pin className="ml-1 inline size-2.5 -translate-y-px" />}
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

/**
 * Editing a cell means one of two quite different things, so the dialog makes the
 * user choose rather than guessing:
 *
 *  - **Set the tier's price** — the common edit. Moves this row in every unit
 *    group's column at once.
 *  - **Pin this one cell** — the escape hatch for a negotiated amount that only
 *    applies to one unit group.
 *
 * Defaulting to the tier price matters: if a bare edit silently pinned, a
 * property would accumulate pins everywhere and lose the benefit of derived
 * pricing entirely.
 */
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
    rowPinCount: number;
    columnCount: number;
  } | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState<"tier" | "cell">("tier");

  // Pinned cells start on the pin tab — that's the thing the user came to change.
  const key = target ? `${target.cell.tierId}:${target.cell.costCodeId}:${target.cell.unitGroupId}` : "";
  const [lastKey, setLastKey] = useState("");
  if (target && key !== lastKey) {
    setLastKey(key);
    setScope(target.cell.pinned ? "cell" : "tier");
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
        if (r.ok && r.pinnedCells > 0) {
          toast.info(
            `${r.pinnedCells} pinned cell${r.pinnedCells === 1 ? "" : "s"} on this row keep their own amount`,
          );
        }
        return r;
      }, `${target.tierName} price updated`);
      return;
    }

    await run(
      () =>
        upsertPin({
          propertyId,
          budgetGroupId: target.cell.tierId,
          costCodeId: target.cell.costCodeId,
          unitGroupId: target.cell.unitGroupId,
          amount: value,
          note: String(fd.get("note") ?? "") || undefined,
        }),
      `Pinned for ${target.groupName}`,
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
                {target.cell.pinned ? "pinned at " : "deriving "}
                {moneyExact(target.cell.amount)}
                {!target.cell.pinned && isRate && ` from ${methodLabel.toLowerCase()}`}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2">
              <ScopeChoice
                checked={scope === "tier"}
                onSelect={() => setScope("tier")}
                title={`Set the ${target.tierName} price`}
                detail={
                  target.columnCount > 1
                    ? `Moves this row for all ${target.columnCount} unit groups on this tier.`
                    : "Moves this row wherever this tier is planned."
                }
              />
              <ScopeChoice
                checked={scope === "cell"}
                onSelect={() => setScope("cell")}
                title={`Pin just ${target.groupName}`}
                detail="A negotiated amount for this one cell. Overrides the pricing method here only."
              />
            </div>

            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="space-y-1.5">
                <Label htmlFor="cell-amount">
                  {scope === "tier"
                    ? isRate
                      ? `${methodLabel} rate ($)`
                      : "Price per unit ($)"
                    : "Amount ($)"}
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
                      ? `A ${methodLabel.toLowerCase()} rate — each group's cell is this × its own quantity.`
                      : "A flat amount every unit group on this tier gets."
                    : "A finished total for this cell, not a rate — it is never multiplied by square footage."}
                </p>
              </div>

              {scope === "cell" && (
                <div className="space-y-1.5">
                  <Label htmlFor="cell-note">Why</Label>
                  <Input
                    id="cell-note"
                    name="note"
                    defaultValue={target.cell.pinNote ?? ""}
                    placeholder="GC quote 6/12"
                  />
                </div>
              )}

              {scope === "tier" && target.rowPinCount > 0 && (
                <p className="rounded border border-hairline bg-alert-bg px-2 py-1.5 text-[11px] text-ink-700">
                  {target.rowPinCount} cell{target.rowPinCount === 1 ? "" : "s"} on this row{" "}
                  {target.rowPinCount === 1 ? "is" : "are"} pinned and will not move.
                </p>
              )}

              <DialogFooter className="gap-2 sm:justify-between">
                {target.cell.pinned ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      run(
                        () =>
                          clearPin({
                            propertyId,
                            budgetGroupId: target.cell.tierId,
                            costCodeId: target.cell.costCodeId,
                            unitGroupId: target.cell.unitGroupId,
                          }),
                        "Pin cleared — cell derives again",
                      )
                    }
                  >
                    Clear pin
                  </Button>
                ) : (
                  <span />
                )}
                <Button type="submit" disabled={busy}>
                  {busy ? "Saving…" : scope === "tier" ? "Update tier price" : "Pin this cell"}
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
  } | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [units, setUnits] = useState("");

  // Two linked inputs over ONE stored value: editing either updates plannedUnits.
  const current = target ? (units === "" ? target.column.plannedUnits : Number(units)) : 0;
  const pct =
    target && target.unitCount > 0 ? Math.round((current / target.unitCount) * 1000) / 10 : 0;

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
          setUnits("");
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
                Fractional values are expected — a 70% penetration of 293 units is 205.1.
              </DialogDescription>
            </DialogHeader>
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="plan-units">Units</Label>
                  <Input
                    id="plan-units"
                    type="number"
                    min="0"
                    step="0.01"
                    value={units === "" ? target.column.plannedUnits : units}
                    onChange={(e) => setUnits(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="plan-pct">Penetration (%)</Label>
                  <Input
                    id="plan-pct"
                    type="number"
                    min="0"
                    step="0.1"
                    value={pct}
                    onChange={(e) =>
                      setUnits(
                        String(
                          Math.round((Number(e.target.value) / 100) * target.unitCount * 100) / 100,
                        ),
                      )
                    }
                  />
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {target.column.actualUnits > 0
                  ? `${target.column.actualUnits} unit${target.column.actualUnits === 1 ? "" : "s"} already started on this tier.`
                  : "No units started on this tier yet."}
              </p>
              <div className="flex justify-end">
                <Button type="submit" disabled={busy}>
                  {busy ? "Saving…" : "Save plan"}
                </Button>
              </div>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

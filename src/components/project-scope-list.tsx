"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { ComboboxSelect } from "@/components/ui/combobox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ProjectPanelSwitch } from "@/components/project-work-panels";
import { createScopeItem, deleteScopeItem, restoreScopeItem, updateScopeItem } from "@/lib/actions/scope";
import { confirmScope, unconfirmScope } from "@/lib/actions/scope-confirm";
import { fmtDate, initials, money } from "@/lib/format";
import { cn } from "@/lib/utils";
import { scopeLineTotal as lineTotal } from "@/lib/scope-total";

export type SpecGrid = { cols: string[]; rows: string[][] };

export type ScopeRow = {
  id: number;
  item: string;
  materialQuality: string | null;
  status: string;
  quantity: string | null;
  unitPrice: string | null;
  costCodeId: number | null;
  vendorId: number | null;
  startDate: string | null;
  endDate: string | null;
  specs: SpecGrid | null;
};

export type ScopeCostCodeOption = { id: number; code: string; name: string };
export type ScopeVendorOption = { id: number; name: string; trade: string | null };

/** Underwriting budget for a cost code, and everything already allocated to it property-wide. */
export type CostCodeBudget = { budget: number; allocated: number };

const DEFAULT_SPEC_COLS = ["Item", "Product", "Notes"];

/** Shared grid so the column header, every group row, and the totals line up. */
const GRID = "grid grid-cols-[minmax(0,1fr)_132px_132px_104px] items-start gap-3.5";

const LABEL = "text-[10px] font-semibold uppercase tracking-[0.09em] text-ink-300";

function initialsOf(name: string): string {
  return initials(name);
}

/**
 * One budget line's worth of scope.
 *
 * The grouping is not decoration: actual spend is only knowable per cost code,
 * because gl_transactions carries a code and a project and no scope item. So
 * the code is the level the Actual column can honestly report, and the group
 * row is where it goes.
 */
type Group = {
  costCodeId: number | null;
  code: string;
  name: string;
  allowance: number;
  actual: number;
  rows: ScopeRow[];
};

export function ProjectScopeList({
  propertyId,
  projectId,
  items,
  costCodes,
  vendors,
  actualByCode,
  budgetByCode,
  approvedBudget,
  committedByLine,
  awardIsDirect,
  scopeConfirmedAt,
  scopeLocked,
  liveRfpCount,
}: {
  propertyId: number;
  projectId: number;
  items: ScopeRow[];
  costCodes: ScopeCostCodeOption[];
  vendors: ScopeVendorOption[];
  actualByCode: Record<number, number>;
  budgetByCode: Record<number, CostCodeBudget>;
  approvedBudget: number;
  /** What an awarded vendor is on the hook for, per scope line. */
  committedByLine: Record<number, number>;
  /** A direct award puts its whole amount on one line, so committed is lumpy. */
  awardIsDirect: boolean;
  scopeConfirmedAt: string | null;
  scopeLocked: boolean;
  liveRfpCount: number;
}) {
  const costCodeOptions = useMemo(
    () => costCodes.map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` })),
    [costCodes],
  );
  const vendorById = useMemo(() => new Map(vendors.map((v) => [v.id, v])), [vendors]);
  const codeById = useMemo(() => new Map(costCodes.map((c) => [c.id, c])), [costCodes]);

  // Editing happens in a dialog rather than an inline panel, so one line is open
  // at a time. `null` = closed, a number = that row, "new" = a line being
  // created, which has no row in the table until it is saved.
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const editingRow = typeof editing === "number" ? items.find((i) => i.id === editing) ?? null : null;

  const vendorCount = new Set(items.map((i) => i.vendorId).filter((v) => v != null)).size;
  const pricedCount = items.filter((i) => lineTotal(i) != null).length;
  const total = items.reduce((sum, i) => sum + (lineTotal(i) ?? 0), 0);
  const committedTotal = items.reduce((sum, i) => sum + (committedByLine[i.id] ?? 0), 0);
  const overApproved = approvedBudget > 0 && total > approvedBudget;

  const groups = useMemo<Group[]>(() => {
    const byCode = new Map<number | null, ScopeRow[]>();
    for (const row of items) {
      const key = row.costCodeId ?? null;
      const list = byCode.get(key);
      if (list) list.push(row);
      else byCode.set(key, [row]);
    }

    const out: Group[] = [];
    for (const [costCodeId, rows] of byCode) {
      const code = costCodeId != null ? codeById.get(costCodeId) : undefined;
      out.push({
        costCodeId,
        code: code?.code ?? "",
        name: code?.name ?? "Not coded to a budget line",
        allowance: costCodeId != null ? (budgetByCode[costCodeId]?.budget ?? 0) : 0,
        actual: costCodeId != null ? (actualByCode[costCodeId] ?? 0) : 0,
        rows,
      });
    }
    // Uncoded last: it is the pile that still needs a decision, and burying it
    // mid-table is how it stays unresolved.
    return out.sort((a, b) => {
      if (a.costCodeId == null) return 1;
      if (b.costCodeId == null) return -1;
      return a.code.localeCompare(b.code);
    });
  }, [items, codeById, budgetByCode, actualByCode]);

  // Actual only ever belongs to a cost code, and the groups above are the codes
  // the scope actually names. Summing actualByCode wholesale put spend from
  // codes with no scope line into a total the visible rows could not add up to.
  const actualInScope = groups.reduce((sum, g) => sum + g.actual, 0);
  const actualEverywhere = Object.values(actualByCode).reduce((sum, v) => sum + v, 0);
  const actualOutsideScope = Math.max(0, actualEverywhere - actualInScope);

  const summary = [
    `${items.length} item${items.length === 1 ? "" : "s"}`,
    vendorCount > 0 ? `${vendorCount} vendor${vendorCount === 1 ? "" : "s"}` : null,
    total > 0 ? `${money(total)} budgeted` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Card className="gap-0 overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between pb-(--card-spacing)">
        <div className="flex flex-wrap items-center gap-3">
          <ProjectPanelSwitch />
          <span className="text-sm text-muted-foreground">{summary}</span>
        </div>
        <Button size="sm" disabled={scopeLocked} onClick={() => setEditing("new")}>
          Add scope item
        </Button>
      </CardHeader>

      <ScopeConfirmBar
        projectId={projectId}
        confirmedAt={scopeConfirmedAt}
        locked={scopeLocked}
        liveRfpCount={liveRfpCount}
      />

      {items.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No scope items yet — add the first with “Add scope item”.
        </p>
      ) : (
        <>
          <div className={cn(GRID, "border-b border-border bg-muted/50 px-5 py-2", LABEL)}>
            <div>Scope item</div>
            <div className="text-right">Budgeted</div>
            <div className="text-right">Committed</div>
            <div className="text-right">Actual</div>
          </div>

          {groups.map((group) => {
            const groupBudgeted = group.rows.reduce((s, r) => s + (lineTotal(r) ?? 0), 0);
            const groupCommitted = group.rows.reduce((s, r) => s + (committedByLine[r.id] ?? 0), 0);
            const overAllowance = group.allowance > 0 && groupBudgeted > group.allowance;

            return (
              <div key={group.costCodeId ?? "uncoded"} className="border-b border-border">
                <div className={cn(GRID, "items-baseline bg-surface-sub/25 px-5 py-2.5")}>
                  <div className="min-w-0">
                    <div
                      className={cn(
                        "font-plex-mono text-[11px] font-bold tracking-[0.04em]",
                        group.costCodeId == null ? "text-alert" : "text-ink-400",
                      )}
                    >
                      {group.costCodeId == null ? "NO BUDGET LINE" : group.code}
                    </div>
                    <div className="truncate text-sm font-semibold text-navy">{group.name}</div>
                  </div>
                  <div className="text-right text-[11px] text-muted-foreground">
                    {group.allowance > 0 ? (
                      <>
                        <span className="tabular-nums">{money(group.allowance)}</span>
                        <br />
                        allowance
                      </>
                    ) : (
                      "—"
                    )}
                  </div>
                  <div />
                  <div />
                </div>

                {group.rows.map((row) => (
                  <ScopeLineRow
                    key={row.id}
                    row={row}
                    vendor={row.vendorId != null ? vendorById.get(row.vendorId) ?? null : null}
                    committed={committedByLine[row.id] ?? null}
                    awardIsDirect={awardIsDirect}
                    onOpen={() => setEditing(row.id)}
                  />
                ))}

                <div className={cn(GRID, "items-baseline bg-surface-sub/25 px-5 py-2")}>
                  <div className={LABEL}>
                    {group.name} subtotal · {group.rows.length} item
                    {group.rows.length === 1 ? "" : "s"}
                  </div>
                  <div
                    className={cn(
                      "text-right text-[12.5px] font-semibold tabular-nums",
                      overAllowance ? "text-alert" : "text-navy",
                    )}
                  >
                    {groupBudgeted > 0 ? money(groupBudgeted) : "—"}
                  </div>
                  <div className="text-right text-[12.5px] font-medium tabular-nums text-ink-500">
                    {groupCommitted > 0 ? money(groupCommitted) : "—"}
                  </div>
                  <div className="text-right text-[12.5px] font-semibold tabular-nums text-navy">
                    {group.actual > 0 ? money(group.actual) : group.costCodeId == null ? "—" : "$0"}
                  </div>
                </div>
              </div>
            );
          })}

          <div className={cn(GRID, "items-baseline bg-muted/60 px-5 py-3.5")}>
            <div className="text-[11px] font-bold uppercase tracking-[0.09em] text-ink-500">
              Total · {items.length} item{items.length === 1 ? "" : "s"} · {pricedCount} priced
            </div>
            <div
              className={cn(
                "text-right text-[15px] font-semibold tabular-nums",
                overApproved ? "text-alert" : "text-navy",
              )}
            >
              {money(total)}
            </div>
            <div className="text-right text-[15px] font-semibold tabular-nums text-navy">
              {committedTotal > 0 ? money(committedTotal) : "—"}
            </div>
            <div className="text-right text-[15px] font-semibold tabular-nums text-navy">
              {actualInScope > 0 ? money(actualInScope) : "$0"}
            </div>
          </div>

          {actualOutsideScope > 0 && (
            // Real posted spend on codes nothing in this scope points at. Folding
            // it into the total above would make the column stop adding up; hiding
            // it entirely would lose the fact that money is going somewhere the
            // scope never described.
            <div
              className={cn(
                GRID,
                "items-baseline border-t border-hairline bg-alert-bg/40 px-5 py-2.5",
              )}
            >
              <div className="text-[12px] text-alert">
                Also posted to budget lines this scope does not cover — worth a look
              </div>
              <div />
              <div />
              <div className="text-right text-[12.5px] font-semibold tabular-nums text-alert">
                {money(actualOutsideScope)}
              </div>
            </div>
          )}
        </>
      )}

      {editing !== null && (
        <ScopeEditorDialog
          // Remount per line so the form always initializes from that row.
          key={typeof editing === "number" ? editing : "new"}
          row={editingRow}
          propertyId={propertyId}
          projectId={projectId}
          costCodeOptions={costCodeOptions}
          vendorById={vendorById}
          budgetByCode={budgetByCode}
          actualByCode={actualByCode}
          onClose={() => setEditing(null)}
        />
      )}
    </Card>
  );
}

/**
 * One scope line, three bands tall: the money, what the work is, and what it is
 * made of.
 *
 * The old row was a single line with a status pill. A scope line is a paragraph
 * of instruction to a contractor and a list of products — a table row that only
 * fits its name was hiding the part that matters, and the status was a second
 * answer to a question the project's phase already answers.
 */
function ScopeLineRow({
  row,
  vendor,
  committed,
  awardIsDirect,
  onOpen,
}: {
  row: ScopeRow;
  vendor: ScopeVendorOption | null;
  committed: number | null;
  awardIsDirect: boolean;
  onOpen: () => void;
}) {
  const budgeted = lineTotal(row);
  const qty = row.quantity ? Number(row.quantity) : null;
  const unit = row.unitPrice ? Number(row.unitPrice) : null;
  // Over what was estimated. Only meaningful when a vendor priced this line, so
  // a direct award — whose whole amount lands on one line by design — is left out.
  const over =
    !awardIsDirect && budgeted != null && committed != null && committed > budgeted
      ? committed - budgeted
      : null;

  const specRows = row.specs?.rows.filter((r) => r.some((c) => c.trim())) ?? [];

  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full cursor-pointer border-b border-hairline px-5 py-3.5 text-left transition-colors last:border-b-0 hover:bg-hover"
    >
      <div className={GRID}>
        <div className="min-w-0">
          <div className="truncate text-[14.5px] font-semibold leading-snug text-navy">
            {row.item || "Untitled item"}
          </div>
          <div className="mt-1 flex items-center gap-2">
            {vendor ? (
              <>
                <span className="flex size-[21px] shrink-0 items-center justify-center rounded-[5px] border border-[#c3d3ec] bg-[#dde6f5] text-[9.5px] font-bold text-[#1b3a6b]">
                  {initialsOf(vendor.name)}
                </span>
                <span className="truncate text-[12.5px] text-ink-500">
                  {vendor.name}
                  {vendor.trade ? ` · ${vendor.trade}` : ""}
                </span>
              </>
            ) : (
              <span className="text-xs text-ink-300">Awaiting award</span>
            )}
          </div>
        </div>

        <div className="text-right">
          <div
            className={cn(
              "text-sm font-semibold tabular-nums",
              budgeted != null ? "text-navy" : "text-ink-200",
            )}
          >
            {budgeted != null ? money(budgeted) : "Not priced"}
          </div>
          {qty != null && unit != null && (
            <div className="text-[11px] tabular-nums text-muted-foreground">
              {qty.toLocaleString()} × {money(unit)}
            </div>
          )}
        </div>

        <div className="text-right">
          <div
            className={cn(
              "text-sm tabular-nums",
              committed != null && committed > 0 ? "font-medium text-ink-500" : "text-ink-200",
            )}
          >
            {committed != null && committed > 0 ? money(committed) : "—"}
          </div>
          {over != null && (
            <div className="text-[11px] tabular-nums text-alert">{money(over)} over</div>
          )}
        </div>

        {/* Actual is a cost-code fact, reported on the group row. */}
        <div className="text-right text-sm text-ink-200">—</div>
      </div>

      <p
        className={cn(
          "mt-2.5 max-w-[62ch] text-[13px] leading-relaxed",
          row.materialQuality?.trim() ? "text-ink-500" : "italic text-ink-300",
        )}
      >
        {row.materialQuality?.trim() ||
          "No description yet — say what the contractor is responsible for on this line."}
      </p>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <span className={cn(LABEL, "mr-0.5")}>Specs</span>
        {specRows.length === 0 ? (
          <span className="text-[11.5px] text-ink-300 underline underline-offset-[3px]">
            Add spec
          </span>
        ) : (
          specRows.slice(0, 4).map((cells, i) => (
            <span
              key={i}
              className="inline-flex max-w-full items-baseline gap-1.5 rounded-[5px] border border-border bg-card px-2 py-[3px] text-[11.5px]"
            >
              <span className="font-semibold text-ink-400">{cells[0] || "—"}</span>
              <span className="truncate text-ink-700">{cells.slice(1).filter(Boolean).join(" · ")}</span>
            </span>
          ))
        )}
        {specRows.length > 4 && (
          <span className="text-[11.5px] text-ink-400">+{specRows.length - 4} more</span>
        )}
      </div>
    </button>
  );
}

/**
 * Confirm the scope, or say why it cannot be.
 *
 * Three states, because there are three: a draft you can still change, a
 * confirmed scope ready to price, and a scope frozen because vendors are
 * holding it. The third is the one worth explaining — the lock covers prices,
 * codes and specs but not dates or vendors, and this bar is the only place
 * anybody is told that.
 *
 * Confirming here and confirming from the workflow gate write the same
 * projects.scope_confirmed_at, so the gate ticks either way.
 */
function ScopeConfirmBar({
  projectId,
  confirmedAt,
  locked,
  liveRfpCount,
}: {
  projectId: number;
  confirmedAt: string | null;
  locked: boolean;
  liveRfpCount: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        toast.error(res.error ?? "That did not work");
        return;
      }
      toast.success(success);
      router.refresh();
    });
  }

  const state = locked ? "locked" : confirmedAt ? "confirmed" : "draft";

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-3 border-b border-border px-5 py-2.5 text-[12.5px]",
        state === "confirmed" && "bg-positive-bg",
        state === "locked" && "bg-gold-soft/12",
        state === "draft" && "bg-muted/50",
      )}
    >
      <button
        type="button"
        role="switch"
        aria-checked={state !== "draft"}
        aria-label={confirmedAt ? "Un-confirm the scope" : "Confirm the scope"}
        disabled={pending || locked}
        onClick={() =>
          confirmedAt
            ? run(() => unconfirmScope({ projectId }), "Scope re-opened for editing")
            : run(() => confirmScope({ projectId }), "Scope confirmed — ready to price")
        }
        className={cn(
          "relative h-[21px] w-[38px] shrink-0 rounded-full transition-colors",
          state === "draft" && "bg-ink-100 hover:bg-ink-200",
          state === "confirmed" && "bg-positive",
          state === "locked" && "cursor-not-allowed bg-gold",
          pending && "opacity-60",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 size-[17px] rounded-full bg-white shadow-sm transition-all",
            state === "draft" ? "left-0.5" : "left-[19px]",
          )}
        />
      </button>

      <span className="text-ink-500">
        {state === "draft" && (
          <>
            <b className="font-semibold text-ink-700">Draft</b> — editable. Confirm when the scope is
            ready to price.
          </>
        )}
        {state === "confirmed" && (
          <>
            <b className="font-semibold text-ink-700">Confirmed</b> {fmtDate(confirmedAt)} — ready to
            price. Un-confirm to keep editing.
          </>
        )}
        {state === "locked" && (
          <>
            <b className="font-semibold text-ink-700">Locked</b> — {liveRfpCount} vendor
            {liveRfpCount === 1 ? " is" : "s are"} pricing this scope. Withdraw the request
            {liveRfpCount === 1 ? "" : "s"} to edit.
          </>
        )}
      </span>

      <span className="ml-auto text-right text-[11px] text-muted-foreground">
        {state === "locked"
          ? "Prices, codes and specs frozen · dates still editable"
          : "Pre-construction gate 2"}
      </span>
    </div>
  );
}

function ScopeEditorDialog({
  row,
  propertyId,
  projectId,
  costCodeOptions,
  vendorById,
  budgetByCode,
  actualByCode,
  onClose,
}: {
  row: ScopeRow | null;
  propertyId: number;
  projectId: number;
  costCodeOptions: { value: number; label: string }[];
  vendorById: Map<number, ScopeVendorOption>;
  budgetByCode: Record<number, CostCodeBudget>;
  actualByCode: Record<number, number>;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [id, setId] = useState<number | null>(row?.id ?? null);
  const [item, setItem] = useState(row?.item ?? "");
  const [materialQuality, setMaterialQuality] = useState(row?.materialQuality ?? "");
  const [quantity, setQuantity] = useState(row?.quantity ?? "");
  const [unitPrice, setUnitPrice] = useState(row?.unitPrice ?? "");
  const [costCodeId, setCostCodeId] = useState<number | null>(row?.costCodeId ?? null);
  // Read-only: the award that covers this line owns it. See applyAwardVendor.
  const vendorId = row?.vendorId ?? null;
  const [startDate, setStartDate] = useState(row?.startDate ?? "");
  const [endDate, setEndDate] = useState(row?.endDate ?? "");
  const [specs, setSpecs] = useState<SpecGrid>(row?.specs ?? { cols: DEFAULT_SPEC_COLS, rows: [] });

  // Fixed snapshot of what this row originally contributed to its budget code,
  // so the remaining-budget figure doesn't double-count this row's own spend.
  const originalCostCodeId = row?.costCodeId ?? null;
  const originalTotal = Number(row?.quantity ?? 0) * Number(row?.unitPrice ?? 0);

  type FieldPatch = Partial<{
    item: string;
    materialQuality: string;
    quantity: string;
    unitPrice: string;
    costCodeId: number | null;
    startDate: string;
    endDate: string;
    specs: SpecGrid;
  }>;

  function commit(patch: FieldPatch) {
    const next = {
      item: patch.item ?? item,
      materialQuality: patch.materialQuality ?? materialQuality,
      quantity: patch.quantity ?? quantity,
      unitPrice: patch.unitPrice ?? unitPrice,
      costCodeId: patch.costCodeId !== undefined ? patch.costCodeId : costCodeId,
      startDate: patch.startDate ?? startDate,
      endDate: patch.endDate ?? endDate,
      specs: patch.specs ?? specs,
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
          startDate: next.startDate || null,
          endDate: next.endDate || null,
          specs: next.specs.rows.length ? next.specs : null,
        });
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        setId(res.id);
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
      onClose();
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
              router.refresh();
            });
          },
        },
      });
      onClose();
      router.refresh();
    });
  }

  function setSpecCell(ri: number, ci: number, value: string) {
    setSpecs({
      cols: specs.cols,
      rows: specs.rows.map((r, i) => (i === ri ? r.map((c, j) => (j === ci ? value : c)) : r)),
    });
  }

  function addSpecRow() {
    setSpecs({ cols: specs.cols, rows: [...specs.rows.map((r) => r.slice()), specs.cols.map(() => "")] });
  }

  const total = quantity && unitPrice ? Number(quantity) * Number(unitPrice) : null;
  const actual = costCodeId != null ? actualByCode[costCodeId] ?? 0 : 0;

  const budget = costCodeId != null ? budgetByCode[costCodeId] : undefined;
  const ownOriginal = originalCostCodeId === costCodeId ? originalTotal : 0;
  const remaining = budget ? budget.budget - (budget.allocated - ownOriginal) - (total ?? 0) : null;
  const overBudget = remaining != null && remaining < 0;
  const vendor = vendorId != null ? vendorById.get(vendorId) ?? null : null;

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{item || "New scope item"}</DialogTitle>
          <DialogDescription>
            {id == null
              ? "Give the line a name to create it — changes save as you go."
              : "Changes save as you go."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
          {/* Left column — narrative, fields, product specs */}
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className={LABEL}>Scope narrative</Label>
              <Textarea
                className="min-h-20 text-sm"
                rows={3}
                value={materialQuality}
                placeholder="What the contractor is responsible for on this line."
                onChange={(e) => setMaterialQuality(e.target.value)}
                onBlur={() => commit({ materialQuality })}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Item">
                <Input
                  className="h-8 text-xs"
                  value={item}
                  placeholder="Item name"
                  onChange={(e) => setItem(e.target.value)}
                  onBlur={() => commit({ item })}
                />
              </Field>
              <Field label="Budget line">
                <ComboboxSelect
                  options={costCodeOptions}
                  value={costCodeId}
                  placeholder="Search codes…"
                  emptyMessage="No matching cost codes"
                  onValueChange={(next) => {
                    setCostCodeId(next);
                    commit({ costCodeId: next });
                  }}
                />
              </Field>
              <Field label="Start">
                <Input
                  className="h-8 text-xs"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  onBlur={() => commit({ startDate })}
                />
              </Field>
              <Field label="Units">
                <Input
                  className="h-8 text-right text-xs"
                  type="number"
                  step="0.01"
                  value={quantity}
                  placeholder="1"
                  onChange={(e) => setQuantity(e.target.value)}
                  onBlur={() => commit({ quantity })}
                />
              </Field>
              <Field label="Unit cost">
                <Input
                  className="h-8 text-right text-xs"
                  type="number"
                  step="0.01"
                  value={unitPrice}
                  placeholder="0.00"
                  onChange={(e) => setUnitPrice(e.target.value)}
                  onBlur={() => commit({ unitPrice })}
                />
              </Field>
              <Field label="End">
                <Input
                  className="h-8 text-xs"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  onBlur={() => commit({ endDate })}
                />
              </Field>
            </div>

            <div className="space-y-1.5">
              <Label className={LABEL}>Product specifications</Label>
              <div className="overflow-hidden rounded-lg border border-border bg-card">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-muted/40">
                      {specs.cols.map((c) => (
                        <th key={c} className={cn("px-3 py-2 text-left", LABEL)}>
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {specs.rows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={specs.cols.length}
                          className="px-3 py-3 text-center text-xs text-muted-foreground"
                        >
                          No specifications yet.
                        </td>
                      </tr>
                    ) : (
                      specs.rows.map((r, ri) => (
                        <tr key={ri} className="border-t border-border">
                          {specs.cols.map((c, ci) => (
                            <td key={c} className="px-2 py-1.5">
                              <Input
                                className="h-7 border-transparent text-xs shadow-none hover:border-input"
                                value={r[ci] ?? ""}
                                placeholder={c}
                                onChange={(e) => setSpecCell(ri, ci, e.target.value)}
                                onBlur={() => commit({ specs })}
                              />
                            </td>
                          ))}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between pt-1">
                <Button size="sm" variant="ghost" onClick={addSpecRow}>
                  Add spec row
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-alert hover:text-alert"
                  disabled={pending}
                  onClick={handleDelete}
                >
                  {id == null ? "Discard" : "Delete scope item"}
                </Button>
              </div>
            </div>
          </div>

          {/* Right rail — money, budget check, vendor */}
          <div className="space-y-3">
            <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-border bg-card">
              <div className="border-r border-border px-3 py-2.5">
                <div className={LABEL}>Total cost</div>
                <div className="mt-1 text-sm font-semibold tabular-nums text-navy">
                  {total != null ? money(total) : "—"}
                </div>
              </div>
              <div className="px-3 py-2.5">
                <div className={LABEL}>Reconciled</div>
                <div className="mt-1 text-sm font-semibold tabular-nums text-navy">
                  {actual > 0 ? money(actual) : "—"}
                </div>
              </div>
            </div>

            {budget && (
              <div
                className={cn(
                  "rounded-lg border px-3 py-2.5",
                  overBudget ? "border-alert/30 bg-alert/5" : "border-border bg-card",
                )}
              >
                <div className={cn(LABEL, overBudget && "text-alert")}>Budget check</div>
                <p
                  className={cn(
                    "mt-1.5 text-xs leading-relaxed",
                    overBudget ? "text-alert" : "text-muted-foreground",
                  )}
                >
                  {overBudget
                    ? `This line puts the budget code ${money(Math.abs(remaining!))} over its ${money(budget.budget)} allowance. Confirm the approval before releasing a contract.`
                    : `${money(remaining ?? 0)} left of the ${money(budget.budget)} allowance on this code.`}
                </p>
              </div>
            )}

            {vendor ? (
              <div className="space-y-3 rounded-lg border border-border bg-card p-3">
                <div className="flex items-center gap-2.5">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-[#c3d3ec] bg-[#dde6f5] text-xs font-bold text-[#1b3a6b]">
                    {initials(vendor.name)}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-navy">{vendor.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{vendor.trade ?? "Vendor"}</div>
                  </div>
                </div>
                <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                  Set by the award covering this line. To change it, award a different bid from the
                  project&rsquo;s Workflow panel.
                </p>
              </div>
            ) : (
              <div className="space-y-2.5 rounded-lg border border-dashed border-border bg-card p-3">
                <p className="text-xs leading-relaxed text-muted-foreground">
                  No vendor yet. One is set when a bid covering this line is awarded.
                </p>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className={LABEL}>{label}</Label>
      {children}
    </div>
  );
}

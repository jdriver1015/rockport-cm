"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
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
import { fmtDate, initials, money } from "@/lib/format";
import { SCOPE_STATUSES, type ScopeStatusKey } from "@/lib/scope-status";
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

/** Shared grid template so the header, every row, and the total line stay aligned. */
const GRID = "grid grid-cols-[1.5fr_1.2fr_auto_0.9fr_130px] items-center gap-4";

const STATUS_PILL: Record<ScopeStatusKey, string> = {
  not_started: "bg-muted text-muted-foreground",
  in_progress: "bg-pending-bg text-pending",
  complete: "bg-positive-bg text-positive",
  blocked: "bg-alert/10 text-alert",
};

const LABEL = "text-[10.5px] font-semibold uppercase tracking-[0.09em] text-ink-300";

function statusLabel(key: string): string {
  return SCOPE_STATUSES.find((s) => s.key === key)?.label ?? key;
}

export function ProjectScopeList({
  propertyId,
  projectId,
  items,
  costCodes,
  vendors,
  actualByCode,
  budgetByCode,
  approvedBudget,
}: {
  propertyId: number;
  projectId: number;
  items: ScopeRow[];
  costCodes: ScopeCostCodeOption[];
  vendors: ScopeVendorOption[];
  actualByCode: Record<number, number>;
  budgetByCode: Record<number, CostCodeBudget>;
  approvedBudget: number;
}) {
  const costCodeOptions = useMemo(
    () => costCodes.map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` })),
    [costCodes],
  );
  const vendorById = useMemo(() => new Map(vendors.map((v) => [v.id, v])), [vendors]);

  // Editing happens in a dialog rather than an inline panel, so one line is open
  // at a time. `null` = closed, a number = that row, "new" = a line being
  // created, which has no row in the table until it is saved.
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const editingRow = typeof editing === "number" ? items.find((i) => i.id === editing) ?? null : null;

  const vendorCount = new Set(items.map((i) => i.vendorId).filter((v) => v != null)).size;
  const pricedCount = items.filter((i) => lineTotal(i) != null).length;
  const total = items.reduce((sum, i) => sum + (lineTotal(i) ?? 0), 0);
  const overApproved = approvedBudget > 0 && total > approvedBudget;

  const summary = [
    `${items.length} item${items.length === 1 ? "" : "s"}`,
    vendorCount > 0 ? `${vendorCount} vendor${vendorCount === 1 ? "" : "s"}` : null,
    total > 0 ? `${money(total)} contracted` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <ProjectPanelSwitch />
          <span className="text-sm text-muted-foreground">{summary}</span>
        </div>
        <Button size="sm" onClick={() => setEditing("new")}>
          Add scope item
        </Button>
      </CardHeader>

      <CardContent className="px-0">
        {items.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No scope items yet — add the first with “Add scope item”.
          </p>
        ) : (
          <>
            <div className={cn(GRID, "border-y border-border bg-muted/40 px-5 py-2", LABEL)}>
              <div>Scope item</div>
              <div>Vendor</div>
              <div>Status</div>
              <div className="text-right">Planned</div>
              <div className="text-right">Cost</div>
            </div>

            {items.map((row) => {
              const t = lineTotal(row);
              const vendor = row.vendorId != null ? vendorById.get(row.vendorId) ?? null : null;
              const dateRange =
                row.startDate || row.endDate ? `${fmtDate(row.startDate)} – ${fmtDate(row.endDate)}` : null;
              return (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => setEditing(row.id)}
                  className={cn(
                    GRID,
                    "w-full cursor-pointer border-b border-border px-5 py-3 text-left last:border-b-0 hover:bg-track",
                  )}
                >
                  <span className="truncate text-sm font-semibold text-navy">
                    {row.item || "Untitled item"}
                  </span>
                  <span className="flex min-w-0 items-center gap-2">
                    {vendor ? (
                      <>
                        <span className="flex size-6 shrink-0 items-center justify-center rounded-md border border-[#c3d3ec] bg-[#dde6f5] text-[10.5px] font-bold text-[#1b3a6b]">
                          {initials(vendor.name)}
                        </span>
                        <span className="truncate text-sm text-ink-700">{vendor.name}</span>
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">Assign vendor</span>
                    )}
                  </span>
                  <span
                    className={cn(
                      "inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold",
                      STATUS_PILL[row.status as ScopeStatusKey] ?? STATUS_PILL.not_started,
                    )}
                  >
                    {statusLabel(row.status)}
                  </span>
                  <span
                    className={cn(
                      "truncate text-right text-xs",
                      dateRange ? "tabular-nums text-muted-foreground" : "text-ink-300",
                    )}
                  >
                    {dateRange ?? "Set dates"}
                  </span>
                  <span
                    className={cn(
                      "text-right text-sm tabular-nums",
                      t != null ? "font-semibold text-navy" : "text-ink-300",
                    )}
                  >
                    {t != null ? money(t) : "Add cost"}
                  </span>
                </button>
              );
            })}

            <div className={cn(GRID, "border-t border-border bg-muted/40 px-5 py-2.5")}>
              <div className={LABEL}>Total</div>
              <div />
              <div />
              <div className="text-right text-xs text-muted-foreground">
                {pricedCount} of {items.length} priced
              </div>
              <div
                className={cn(
                  "text-right text-sm font-semibold tabular-nums",
                  overApproved ? "text-alert" : "text-navy",
                )}
              >
                {money(total)}
              </div>
            </div>
          </>
        )}
      </CardContent>

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
  const [status, setStatus] = useState(row?.status ?? "not_started");
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
    status: string;
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
      status: patch.status ?? status,
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
          status: next.status as ScopeStatusKey,
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
              <Field label="Status">
                <select
                  value={status}
                  onChange={(e) => {
                    setStatus(e.target.value);
                    commit({ status: e.target.value });
                  }}
                  className="h-8 w-full rounded-control border border-input bg-transparent px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  {SCOPE_STATUSES.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </select>
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

"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDownIcon, ChevronRightIcon, EllipsisIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ComboboxSelect } from "@/components/ui/combobox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createScopeItem, deleteScopeItem, restoreScopeItem, updateScopeItem } from "@/lib/actions/scope";
import { fmtDate, money } from "@/lib/format";
import { SCOPE_STATUSES, type ScopeStatusKey } from "@/lib/scope-status";
import { cn } from "@/lib/utils";

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
};

export type ScopeCostCodeOption = { id: number; code: string; name: string };
export type ScopeVendorOption = { id: number; name: string };

/** Underwriting budget for a cost code, and everything already allocated to it property-wide. */
export type CostCodeBudget = { budget: number; allocated: number };

const STATUS_PILL: Record<ScopeStatusKey, string> = {
  not_started: "bg-muted text-muted-foreground",
  in_progress: "bg-pending-bg text-pending",
  complete: "bg-positive-bg text-positive",
  blocked: "bg-alert/10 text-alert",
};

function statusLabel(key: string): string {
  return SCOPE_STATUSES.find((s) => s.key === key)?.label ?? key;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

export function ProjectScopeList({
  propertyId,
  projectId,
  items,
  costCodes,
  vendors,
  actualByCode,
  budgetByCode,
}: {
  propertyId: number;
  projectId: number;
  items: ScopeRow[];
  costCodes: ScopeCostCodeOption[];
  vendors: ScopeVendorOption[];
  actualByCode: Record<number, number>;
  budgetByCode: Record<number, CostCodeBudget>;
}) {
  const costCodeOptions = useMemo(
    () => costCodes.map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` })),
    [costCodes],
  );
  const vendorOptions = useMemo(() => vendors.map((v) => ({ value: v.id, label: v.name })), [vendors]);
  const vendorById = useMemo(() => new Map(vendors.map((v) => [v.id, v])), [vendors]);

  const [drafts, setDrafts] = useState<{ key: string; createdId: number | null }[]>([]);
  const visibleDrafts = drafts.filter(
    (d) => d.createdId == null || !items.some((i) => i.id === d.createdId),
  );

  const [openIds, setOpenIds] = useState<Set<number>>(new Set());
  const allOpen = items.length > 0 && items.every((i) => openIds.has(i.id));

  const vendorCount = new Set(items.map((i) => i.vendorId).filter((v) => v != null)).size;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h2 className="font-heading text-base leading-snug font-medium text-navy">Scope items</h2>
          <span className="text-sm text-muted-foreground">
            {items.length} item{items.length === 1 ? "" : "s"}
            {vendorCount > 0 && ` · ${vendorCount} vendor${vendorCount === 1 ? "" : "s"}`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setOpenIds(allOpen ? new Set() : new Set(items.map((i) => i.id)))}
          >
            {allOpen ? "Collapse all" : "Expand all"}
          </Button>
          <Button
            size="sm"
            onClick={() => setDrafts((ds) => [...ds, { key: crypto.randomUUID(), createdId: null }])}
          >
            Add scope item
          </Button>
        </div>
      </div>

      {items.length === 0 && visibleDrafts.length === 0 ? (
        <p className="rounded-lg border border-border bg-card py-8 text-center text-sm text-muted-foreground">
          No scope items yet — add the first with “Add scope item”.
        </p>
      ) : (
        <div className="space-y-2.5">
          {items.map((row) => (
            <ScopeCard
              key={row.id}
              row={row}
              propertyId={propertyId}
              projectId={projectId}
              costCodeOptions={costCodeOptions}
              vendorOptions={vendorOptions}
              vendorName={row.vendorId != null ? vendorById.get(row.vendorId)?.name ?? null : null}
              budgetByCode={budgetByCode}
              actualByCode={actualByCode}
              open={openIds.has(row.id)}
              onToggle={() =>
                setOpenIds((s) => {
                  const next = new Set(s);
                  if (next.has(row.id)) next.delete(row.id);
                  else next.add(row.id);
                  return next;
                })
              }
            />
          ))}
          {visibleDrafts.map((d) => (
            <ScopeCard
              key={d.key}
              row={null}
              propertyId={propertyId}
              projectId={projectId}
              costCodeOptions={costCodeOptions}
              vendorOptions={vendorOptions}
              vendorName={null}
              budgetByCode={budgetByCode}
              actualByCode={actualByCode}
              open
              onToggle={() => {}}
              onDraftCreated={(id) =>
                setDrafts((ds) => ds.map((x) => (x.key === d.key ? { ...x, createdId: id } : x)))
              }
              onDraftRemoved={() => setDrafts((ds) => ds.filter((x) => x.key !== d.key))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ScopeCard({
  row,
  propertyId,
  projectId,
  costCodeOptions,
  vendorOptions,
  vendorName,
  budgetByCode,
  actualByCode,
  open,
  onToggle,
  onDraftCreated,
  onDraftRemoved,
}: {
  row: ScopeRow | null;
  propertyId: number;
  projectId: number;
  costCodeOptions: { value: number; label: string }[];
  vendorOptions: { value: number; label: string }[];
  vendorName: string | null;
  budgetByCode: Record<number, CostCodeBudget>;
  actualByCode: Record<number, number>;
  open: boolean;
  onToggle: () => void;
  onDraftCreated?: (id: number) => void;
  onDraftRemoved?: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [id, setId] = useState<number | null>(row?.id ?? null);
  const [item, setItem] = useState(row?.item ?? "");
  const [materialQuality, setMaterialQuality] = useState(row?.materialQuality ?? "");
  const [quantity, setQuantity] = useState(row?.quantity ?? "");
  const [unitPrice, setUnitPrice] = useState(row?.unitPrice ?? "");
  const [costCodeId, setCostCodeId] = useState<number | null>(row?.costCodeId ?? null);
  const [vendorId, setVendorId] = useState<number | null>(row?.vendorId ?? null);
  const [status, setStatus] = useState(row?.status ?? "not_started");
  const [startDate, setStartDate] = useState(row?.startDate ?? "");
  const [endDate, setEndDate] = useState(row?.endDate ?? "");

  // Fixed snapshot of what this row originally contributed to its budget code,
  // so the remaining-budget preview doesn't double-count this row's own spend.
  const originalCostCodeId = row?.costCodeId ?? null;
  const originalTotal = Number(row?.quantity ?? 0) * Number(row?.unitPrice ?? 0);

  type FieldPatch = Partial<{
    item: string;
    materialQuality: string;
    quantity: string;
    unitPrice: string;
    costCodeId: number | null;
    vendorId: number | null;
    status: string;
    startDate: string;
    endDate: string;
  }>;

  function commit(patch: FieldPatch) {
    const next = {
      item: patch.item ?? item,
      materialQuality: patch.materialQuality ?? materialQuality,
      quantity: patch.quantity ?? quantity,
      unitPrice: patch.unitPrice ?? unitPrice,
      costCodeId: patch.costCodeId !== undefined ? patch.costCodeId : costCodeId,
      vendorId: patch.vendorId !== undefined ? patch.vendorId : vendorId,
      status: patch.status ?? status,
      startDate: patch.startDate ?? startDate,
      endDate: patch.endDate ?? endDate,
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
          vendorId: next.vendorId,
          status: next.status as ScopeStatusKey,
          startDate: next.startDate || null,
          endDate: next.endDate || null,
        });
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        setId(res.id);
        onDraftCreated?.(res.id);
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
      onDraftRemoved?.();
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
            });
          },
        },
      });
      router.refresh();
    });
  }

  const qtyNum = quantity ? Number(quantity) : null;
  const priceNum = unitPrice ? Number(unitPrice) : null;
  const totalCost = qtyNum != null && priceNum != null ? qtyNum * priceNum : null;
  const actual = costCodeId != null ? actualByCode[costCodeId] ?? 0 : 0;

  const selectedBudget = costCodeId != null ? budgetByCode[costCodeId] : undefined;
  const ownOriginal = originalCostCodeId === costCodeId ? originalTotal : 0;
  const remaining = selectedBudget
    ? selectedBudget.budget - (selectedBudget.allocated - ownOriginal) - (totalCost ?? 0)
    : null;

  const dateRange =
    startDate || endDate ? `${fmtDate(startDate || null)} – ${fmtDate(endDate || null)}` : "—";

  return (
    <div
      className={cn(
        "rounded-xl border bg-card transition-shadow",
        open ? "border-ink-300 shadow-md" : "border-border shadow-sm",
        pending && "opacity-60",
      )}
    >
      {/* Collapsed summary row */}
      <div
        className="grid cursor-pointer grid-cols-[1.4fr_1.2fr_auto_1fr_auto_auto] items-center gap-4 px-4 py-3.5"
        onClick={onToggle}
      >
        <div className="truncate font-semibold text-navy">{item || "Untitled item"}</div>
        <div className="flex min-w-0 items-center gap-2">
          {vendorName ? (
            <>
              <span className="flex size-6 shrink-0 items-center justify-center rounded-md border border-[#c3d3ec] bg-[#dde6f5] text-[10.5px] font-bold text-[#1b3a6b]">
                {initials(vendorName)}
              </span>
              <span className="truncate text-sm text-ink-700">{vendorName}</span>
            </>
          ) : (
            <span className="text-sm text-muted-foreground">No vendor</span>
          )}
        </div>
        <span
          className={cn(
            "inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold",
            STATUS_PILL[status as ScopeStatusKey] ?? STATUS_PILL.not_started,
          )}
        >
          {statusLabel(status)}
        </span>
        <span className="text-right tabular-nums text-xs whitespace-nowrap text-muted-foreground">{dateRange}</span>
        <span className="w-24 text-right tabular-nums text-sm font-semibold text-navy">
          {totalCost != null ? money(totalCost) : "—"}
        </span>
        <span className="text-muted-foreground">
          {open ? <ChevronDownIcon className="size-4" /> : <ChevronRightIcon className="size-4" />}
        </span>
      </div>

      {open && (
        <div className="space-y-4 border-t border-border bg-muted/30 px-4 py-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-ink-300">
                Item
              </Label>
              <Input
                className="h-8 text-xs"
                value={item}
                placeholder="Item name"
                onChange={(e) => setItem(e.target.value)}
                onBlur={() => commit({ item })}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-ink-300">
                Vendor
              </Label>
              <ComboboxSelect
                options={vendorOptions}
                value={vendorId}
                placeholder="Search vendors…"
                emptyMessage="No matching vendors"
                onValueChange={(next) => {
                  setVendorId(next);
                  commit({ vendorId: next });
                }}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-ink-300">
              Description
            </Label>
            <Textarea
              className="min-h-16 text-xs"
              rows={3}
              value={materialQuality}
              placeholder="Scope narrative — materials, grade, what's included"
              onChange={(e) => setMaterialQuality(e.target.value)}
              onBlur={() => commit({ materialQuality })}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-4">
            <div className="space-y-1.5">
              <Label className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-ink-300">
                Status
              </Label>
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
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-ink-300">
                Start
              </Label>
              <Input
                className="h-8 text-xs"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                onBlur={() => commit({ startDate })}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-ink-300">
                End
              </Label>
              <Input
                className="h-8 text-xs"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                onBlur={() => commit({ endDate })}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-ink-300">
                Budget line
              </Label>
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
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-4">
            <div className="space-y-1.5">
              <Label className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-ink-300">
                Units
              </Label>
              <Input
                className="h-8 text-right text-xs"
                type="number"
                step="0.01"
                value={quantity}
                placeholder="1"
                onChange={(e) => setQuantity(e.target.value)}
                onBlur={() => commit({ quantity })}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-ink-300">
                Unit cost
              </Label>
              <Input
                className="h-8 text-right text-xs"
                type="number"
                step="0.01"
                value={unitPrice}
                placeholder="0.00"
                onChange={(e) => setUnitPrice(e.target.value)}
                onBlur={() => commit({ unitPrice })}
              />
            </div>
            <ReadOnlyStat label="Total cost" value={totalCost != null ? money(totalCost) : "—"} />
            <ReadOnlyStat label="Reconciled cost" value={actual > 0 ? money(actual) : "—"} />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
            <p className="text-xs text-muted-foreground">
              {selectedBudget ? (
                <>
                  Budget line total <span className="font-medium text-navy">{money(selectedBudget.budget)}</span>
                  {" · "}
                  Remaining after this line{" "}
                  <span
                    className={cn(
                      "font-medium",
                      remaining != null && remaining < 0 ? "text-red-600" : "text-navy",
                    )}
                  >
                    {money(remaining ?? 0)}
                  </span>
                </>
              ) : (
                "No budget line assigned."
              )}
            </p>
            <DropdownMenu>
              <DropdownMenuTrigger disabled={pending} render={<Button variant="ghost" size="icon-sm" />}>
                <EllipsisIcon />
                <span className="sr-only">Actions</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem variant="destructive" disabled={pending} onClick={handleDelete}>
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      )}
    </div>
  );
}

function ReadOnlyStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-ink-300">
        {label}
      </Label>
      <div className="flex h-8 items-center justify-end rounded-control border border-transparent bg-card px-2 tabular-nums text-xs font-semibold text-navy">
        {value}
      </div>
    </div>
  );
}

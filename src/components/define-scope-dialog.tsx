"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { AlertTriangleIcon, CheckCircle2Icon, LockIcon, Trash2Icon } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtDate } from "@/lib/format";
import { importFindingsToScope } from "@/lib/actions/pre-walk";
import { createScopeItem, deleteScopeItem, updateScopeItem } from "@/lib/actions/scope";
import { confirmScope, unconfirmScope } from "@/lib/actions/scope-confirm";
import { setProjectBudget } from "@/lib/actions/project-budget";

export type PreWalkFinding = {
  id: number;
  title: string;
  description: string | null;
  severity: string;
  location: string | null;
  /** Already turned into a scope line. */
  inScope: boolean;
};

export type BudgetContext = {
  approved: number;
  costCodeId: number | null;
  /** Non-interior codes from this property's chart. Empty for an interior turn. */
  costCodes: { id: number; code: string; name: string }[];
  /** An interior turn's budget comes from its renovation template. */
  kind: "unit" | "common";
};

export type ScopeLine = {
  id: number;
  item: string;
  materialQuality: string | null;
  quantity: string | null;
  unitPrice: string | null;
  costCodeName: string | null;
};

/** Qty × unit cost, or null when the line has not been costed. */
export function lineTotal(line: { quantity: string | null; unitPrice: string | null }) {
  if (line.unitPrice == null || line.unitPrice === "") return null;
  const unit = Number(line.unitPrice);
  if (!Number.isFinite(unit)) return null;
  const qty = line.quantity == null || line.quantity === "" ? 1 : Number(line.quantity);
  if (!Number.isFinite(qty)) return null;
  return unit * qty;
}

const usd = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** One grid for the header, every row and the totals, so the columns line up. */
const SCOPE_GRID =
  "grid grid-cols-[20px_minmax(0,1fr)_64px_84px_92px_minmax(0,110px)_28px] items-start gap-2";

/**
 * Resolve the Confirm Scope and Budget gate.
 *
 * One table, because the scope and the budget are one thing: the budget is what
 * the scope costs. They were two stacked sections asking you to reconcile a
 * number against a list by eye, which is the work the screen should be doing.
 *
 * Editable here: the wording, the quantity, the unit cost, and whether the line
 * belongs at all — everything that decides what a vendor is asked to price and
 * what it is expected to come to. Cost codes, dates, vendors and spec grids stay
 * on the scope list below, which is built for them. Missing cost codes are
 * flagged rather than fixed: this is the last moment before the scope is priced,
 * and a line with no code will not reconcile later.
 */
export function DefineScopeDialog({
  open,
  onOpenChange,
  propertyId,
  projectId,
  lines,
  budget,
  scopeConfirmedAt,
  scopeLocked,
  findings,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  propertyId: number;
  projectId: number;
  lines: ScopeLine[];
  budget: BudgetContext;
  /** Set once the scope is agreed as ready to price — pre-con gate 2. */
  scopeConfirmedAt: string | null;
  /** True once an RFP is out: vendors are pricing these lines, so they are frozen. */
  scopeLocked: boolean;
  findings: PreWalkFinding[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const scopeLineCount = lines.length;
  const missingCode = lines.filter((l) => !l.costCodeName).length;
  const [approved, setApproved] = useState(budget.approved > 0 ? String(budget.approved) : "");

  // What the lines actually add up to. Null lines contribute nothing, so an
  // uncosted scope totals zero rather than guessing at a number.
  const costed = lines.map(lineTotal).filter((n): n is number => n != null);
  const scopeTotal = costed.reduce((a, b) => a + b, 0);
  const uncostedCount = lines.length - costed.length;

  const approvedValue = Number(approved);
  const budgetOk = approved.trim() !== "" && Number.isFinite(approvedValue) && approvedValue > 0;
  // Worth saying out loud when they disagree: one of the two is wrong, and
  // which one is a judgement only the person can make.
  const differs = budgetOk && scopeTotal > 0 && Math.abs(approvedValue - scopeTotal) >= 1;

  function saveBudget() {
    return setProjectBudget({ projectId, budgetAmount: approved.trim() });
  }

  const importable = findings.filter((f) => !f.inScope);
  // Default to all, as with every other bulk action here.
  const [picked, setPicked] = useState<Set<number>>(() => new Set(importable.map((f) => f.id)));
  const [manual, setManual] = useState("");

  function importPicked() {
    if (picked.size === 0) return;
    startTransition(async () => {
      const res = await importFindingsToScope({ projectId, findingIds: [...picked] });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        res.skipped > 0
          ? `${res.added} line(s) added — ${res.skipped} were already scope`
          : `${res.added} line(s) added to scope`,
      );
      router.refresh();
    });
  }

  function confirm() {
    startTransition(async () => {
      // The budget is part of what is being confirmed, so it is saved by the
      // same press rather than needing its own. Confirming a scope while the
      // budget field still holds an unsaved number would confirm the wrong pair.
      const saved = await saveBudget();
      if (!saved.ok) {
        toast.error(saved.error);
        return;
      }
      const res = await confirmScope({ projectId });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Scope and budget confirmed — ready to send out for pricing");
      onOpenChange(false);
      router.refresh();
    });
  }

  function unconfirm() {
    startTransition(async () => {
      const res = await unconfirmScope({ projectId });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Scope re-opened");
      router.refresh();
    });
  }

  function addManual() {
    const item = manual.trim();
    if (!item) return;
    startTransition(async () => {
      const res = await createScopeItem({ propertyId, projectId, item });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setManual("");
      toast.success(`Added ${item}`);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Scope and budget</DialogTitle>
          <DialogDescription>
            What the vendors will price, and what you have approved to spend on it. The line items
            are not costed — pricing comes back from the bids.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-ink-300">
                Scope · {scopeLineCount} line{scopeLineCount === 1 ? "" : "s"}
              </span>
              {scopeLocked && (
                <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                  <LockIcon className="size-3" />
                  Locked while out for bid
                </span>
              )}
            </div>

            {scopeLineCount === 0 ? (
              <p className="rounded-card border border-dashed border-border px-3 py-6 text-center text-[13px] text-muted-foreground">
                Nothing scoped yet.
              </p>
            ) : (
              <div className="rounded-card border border-border">
                <div className={cn(SCOPE_GRID, "border-b border-border px-3 py-1.5")}>
                  <span />
                  <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-300">
                    Item
                  </span>
                  <span className="text-right text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-300">
                    Qty
                  </span>
                  <span className="text-right text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-300">
                    Unit $
                  </span>
                  <span className="text-right text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-300">
                    Total
                  </span>
                  <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-300">
                    Cost code
                  </span>
                  <span />
                </div>

                <div className="max-h-64 divide-y divide-hairline overflow-y-auto">
                  {lines.map((line, i) => (
                    <ScopeLineRow
                      key={line.id}
                      index={i + 1}
                      line={line}
                      propertyId={propertyId}
                      projectId={projectId}
                      locked={scopeLocked}
                    />
                  ))}
                </div>

                {/*
                  The budget sits at the foot of the scope rather than in a
                  section of its own, because it is the scope's total. Seeded
                  from the lines, overridable for a lump sum nobody has broken
                  down yet.
                */}
                <div className="border-t border-border bg-muted/25 px-3 py-2.5">
                  <div className={cn(SCOPE_GRID, "items-center")}>
                    <span />
                    <span className="text-[12px] text-muted-foreground">
                      {uncostedCount > 0
                        ? `${costed.length} of ${lines.length} lines costed`
                        : "All lines costed"}
                    </span>
                    <span />
                    <span className="text-right text-[11px] uppercase tracking-[0.08em] text-ink-300">
                      Scope
                    </span>
                    <span className="text-right text-[13px] font-semibold tabular-nums text-navy">
                      {scopeTotal > 0 ? usd(scopeTotal) : "—"}
                    </span>
                    <span />
                    <span />
                  </div>

                  <div className={cn(SCOPE_GRID, "mt-2 items-center")}>
                    <span />
                    <label
                      htmlFor="confirm-budget"
                      className="text-[13px] font-medium text-navy"
                    >
                      Approved budget
                    </label>
                    <span />
                    <span />
                    <Input
                      id="confirm-budget"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      className="h-8 text-right text-[13px] tabular-nums"
                      value={approved}
                      disabled={pending || scopeLocked}
                      onChange={(e) => setApproved(e.target.value)}
                    />
                    <span>
                      {differs && !scopeLocked && (
                        <button
                          type="button"
                          className="text-[11.5px] text-link hover:underline"
                          onClick={() => setApproved(String(Math.round(scopeTotal * 100) / 100))}
                        >
                          Use scope total
                        </button>
                      )}
                    </span>
                    <span />
                  </div>

                  {differs && (
                    <p className="mt-1.5 pl-8 text-[11.5px] text-alert">
                      The approved budget is {usd(Math.abs(approvedValue - scopeTotal))}{" "}
                      {approvedValue > scopeTotal ? "above" : "below"} what the lines add up to.
                    </p>
                  )}
                </div>
              </div>
            )}

            {missingCode > 0 && (
              // The last moment this is cheap to fix. After the bid comes back
              // the spend has nowhere to reconcile to and nobody remembers why.
              <p className="flex items-start gap-1.5 text-[11.5px] text-alert">
                <AlertTriangleIcon className="mt-px size-3.5 shrink-0" />
                {missingCode} line{missingCode === 1 ? " has" : "s have"} no cost code — set them on
                the scope list below or the spend will not reconcile.
              </p>
            )}
          </div>

          {importable.length > 0 && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-ink-300">
                  From the pre-walk
                </span>
                {importable.length > 0 && (
                  <button
                    type="button"
                    className="text-[11px] text-link hover:underline"
                    onClick={() =>
                      setPicked((p) =>
                        p.size === importable.length ? new Set() : new Set(importable.map((f) => f.id)),
                      )
                    }
                  >
                    {picked.size === importable.length ? "Clear all" : "Select all"}
                  </button>
                )}
              </div>

              {(
                <div className="max-h-64 divide-y divide-hairline overflow-y-auto rounded-card border border-border">
                  {findings.map((f) => (
                    <label
                      key={f.id}
                      className={cn(
                        "flex items-start gap-2.5 px-3 py-2",
                        f.inScope ? "bg-hairline/50" : "cursor-pointer hover:bg-track",
                      )}
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5 size-3.5 accent-navy"
                        disabled={f.inScope || pending}
                        checked={f.inScope || picked.has(f.id)}
                        onChange={(e) =>
                          setPicked((p) => {
                            const next = new Set(p);
                            if (e.target.checked) next.add(f.id);
                            else next.delete(f.id);
                            return next;
                          })
                        }
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-baseline gap-2">
                          <span
                            className={cn(
                              "text-[13px]",
                              f.inScope ? "text-ink-300" : "font-medium text-navy",
                            )}
                          >
                            {f.title}
                          </span>
                          {f.location && (
                            <span className="text-[11px] text-muted-foreground">{f.location}</span>
                          )}
                          {f.inScope && (
                            <span className="text-[10.5px] uppercase tracking-[0.09em] text-ink-300">
                              already scope
                            </span>
                          )}
                        </span>
                        {f.description && (
                          <span className="block truncate text-xs text-muted-foreground">
                            {f.description}
                          </span>
                        )}
                      </span>
                    </label>
                  ))}
                </div>
              )}

              {importable.length > 0 && (
                <div className="flex justify-end">
                  <Button size="sm" disabled={pending || picked.size === 0} onClick={importPicked}>
                    Add {picked.size} to scope
                  </Button>
                </div>
              )}
            </div>
          )}

          <div className="space-y-2 border-t border-border pt-4">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-ink-300">
              Add a line the walk missed
            </span>
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                addManual();
              }}
            >
              <Input
                className="h-8 min-w-64 flex-1 text-xs"
                placeholder="e.g. Replace bathroom exhaust fan"
                value={manual}
                disabled={pending || scopeLocked}
                onChange={(e) => setManual(e.target.value)}
              />
              <Button
                type="submit"
                size="sm"
                variant="outline"
                disabled={pending || scopeLocked || !manual.trim()}
              >
                Add line
              </Button>
            </form>
            <p className="text-[11px] text-muted-foreground">
              Cost codes, quantities and dates are set on the scope list below — this just gets the
              line onto it.
            </p>
          </div>

          {/*
            Confirming is gate 2, and it is also the last free edit: sending the
            scope out is what locks it, so this is where a person should be told
            that before they press anything.
          */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-muted/30 px-3.5 py-3">
            {scopeConfirmedAt ? (
              <>
                <p className="min-w-0 flex-1 text-[12.5px] text-ink-600">
                  <CheckCircle2Icon className="mr-1.5 inline size-3.5 -translate-y-px text-positive" />
                  Confirmed {fmtDate(scopeConfirmedAt)}.{" "}
                  {scopeLocked
                    ? "Out for pricing — withdraw the requests to change anything."
                    : "Both stay editable until you send it out for pricing."}
                </p>
                {!scopeLocked && (
                  <Button variant="ghost" size="sm" disabled={pending} onClick={unconfirm}>
                    Re-open
                  </Button>
                )}
              </>
            ) : (
              <>
                <p className="min-w-0 flex-1 text-[12.5px] text-muted-foreground">
                  {scopeLineCount === 0
                    ? "Add at least one line before confirming."
                    : !budgetOk
                      ? "Set an approved budget — it is what the bids will be measured against."
                      : "Confirm when these lines and this budget are what you want priced."}
                </p>
                <Button
                  size="sm"
                  disabled={pending || scopeLineCount === 0 || !budgetOk}
                  onClick={confirm}
                >
                  Confirm scope and budget
                </Button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * One line, as the vendor will see it.
 *
 * Saves on blur rather than behind a Save button: this is a review pass, and
 * making someone confirm each correction before confirming the whole scope is
 * one ceremony too many. A refused save says why and puts the old value back,
 * so the row never shows something the database did not accept.
 */
function ScopeLineRow({
  index,
  line,
  propertyId,
  projectId,
  locked,
}: {
  index: number;
  line: ScopeLine;
  propertyId: number;
  projectId: number;
  locked: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [item, setItem] = useState(line.item);
  const [quantity, setQuantity] = useState(line.quantity ?? "");
  const [unitPrice, setUnitPrice] = useState(line.unitPrice ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Off the edited values, not the saved ones, so the number moves as you type.
  const total = lineTotal({ quantity: quantity || null, unitPrice: unitPrice || null });

  function save(
    patch: { item?: string; quantity?: string | null; unitPrice?: string | null },
    revert: () => void,
  ) {
    startTransition(async () => {
      const res = await updateScopeItem({ id: line.id, propertyId, projectId, ...patch });
      if (!res.ok) {
        toast.error(res.error);
        revert();
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className={cn(SCOPE_GRID, "px-3 py-2")}>
      <span className="pt-2 text-[11px] tabular-nums text-ink-300">{index}</span>

      <div className="min-w-0">
        <Input
          className="h-8 text-[13px]"
          value={item}
          disabled={pending || locked}
          onChange={(e) => setItem(e.target.value)}
          onBlur={() => {
            const next = item.trim();
            if (!next) {
              setItem(line.item);
              return;
            }
            if (next === line.item) return;
            save({ item: next }, () => setItem(line.item));
          }}
          aria-label={`Line ${index} description`}
        />
        {line.materialQuality && (
          <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
            {line.materialQuality}
          </p>
        )}
      </div>

      <Input
        className="h-8 text-right text-[13px] tabular-nums"
        placeholder="Qty"
        inputMode="decimal"
        value={quantity}
        disabled={pending || locked}
        onChange={(e) => setQuantity(e.target.value)}
        onBlur={() => {
          const next = quantity.trim();
          if (next === (line.quantity ?? "")) return;
          save({ quantity: next || null }, () => setQuantity(line.quantity ?? ""));
        }}
        aria-label={`Line ${index} quantity`}
      />

      <Input
        className="h-8 text-right text-[13px] tabular-nums"
        placeholder="Unit $"
        inputMode="decimal"
        value={unitPrice}
        disabled={pending || locked}
        onChange={(e) => setUnitPrice(e.target.value)}
        onBlur={() => {
          const next = unitPrice.trim();
          if (next === (line.unitPrice ?? "")) return;
          save({ unitPrice: next || null }, () => setUnitPrice(line.unitPrice ?? ""));
        }}
        aria-label={`Line ${index} unit cost`}
      />

      <span
        className={cn(
          "pt-2 text-right text-[13px] tabular-nums",
          total == null ? "text-ink-300" : "text-ink-700",
        )}
      >
        {total == null ? "—" : usd(total)}
      </span>

      <span className="min-w-0 pt-2">
        {line.costCodeName ? (
          <span className="block truncate text-[11.5px] text-ink-500">{line.costCodeName}</span>
        ) : (
          <span className="text-[11.5px] text-alert">No cost code</span>
        )}
      </span>

      <span className="pt-1.5 text-right">
        {locked ? null : confirmDelete ? (
          <button
            type="button"
            className="text-[11px] font-medium text-alert hover:underline"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const res = await deleteScopeItem({ id: line.id, propertyId, projectId });
                if (!res.ok) {
                  toast.error(res.error);
                  return;
                }
                setConfirmDelete(false);
                router.refresh();
              })
            }
            onBlur={() => setConfirmDelete(false)}
            aria-label={`Confirm removing line ${index}`}
          >
            Sure?
          </button>
        ) : (
          <button
            type="button"
            className="text-ink-300 transition-colors hover:text-alert"
            disabled={pending}
            onClick={() => setConfirmDelete(true)}
            aria-label={`Remove line ${index}`}
          >
            <Trash2Icon className="size-3.5" />
          </button>
        )}
      </span>
    </div>
  );
}

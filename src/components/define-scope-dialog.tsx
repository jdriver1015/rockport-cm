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
import { fmtDate, moneyExact } from "@/lib/format";
import { importFindingsToScope } from "@/lib/actions/walks";
import { deleteScopeItem, updateScopeItem } from "@/lib/actions/scope";
import { confirmScope, unconfirmScope } from "@/lib/actions/scope-confirm";
import { scopeLineTotal } from "@/lib/scope-total";
import { DescriptionEditor } from "@/components/scope-inline-editors";

export type PreWalkFinding = {
  id: number;
  title: string;
  description: string | null;
  severity: string;
  location: string | null;
  /** Already turned into a scope line. */
  inScope: boolean;
};

export type ScopeLine = {
  id: number;
  item: string;
  materialQuality: string | null;
  quantity: string | null;
  unitPrice: string | null;
  costCodeName: string | null;
};

/**
 * One grid for the header, every row and the totals, so the columns line up.
 * No baked-in `items-*`: a line splits into a label/input/description stack
 * of its own sub-rows (see ScopeLineRow), each choosing the alignment that
 * suits its content rather than sharing one that suits none of them.
 */
const SCOPE_GRID = "grid grid-cols-[20px_minmax(0,1fr)_60px_112px_104px_28px] gap-3.5";

/**
 * Resolve the Confirm Scope and Budget gate.
 *
 * One table, because the scope and the budget are one thing: the budget is what
 * the scope costs. They were two stacked sections asking you to reconcile a
 * number against a list by eye, which is the work the screen should be doing.
 *
 * Editable here: the wording, the description, the quantity, the unit cost, and
 * whether the line belongs at all — everything that decides what a vendor is
 * asked to price and what it is expected to come to. Dates, vendors and spec
 * grids stay on the project's Scope tab, which is built for them. The budget
 * category rides along as a label, the same read-only note the Scope tab
 * shows on its own rows — it is set there, not here, but a person confirming
 * what vendors will price needs to see where each line lands without
 * switching tabs to check.
 * Missing cost codes are flagged rather than fixed here: this is the last
 * moment before the scope is priced, and a line with no code will not
 * reconcile later — but unlike a description, there's no single field this
 * dialog could offer that would fix it (it's a search, not a sentence).
 */
export function DefineScopeDialog({
  open,
  onOpenChange,
  propertyId,
  projectId,
  lines,
  requireDescriptions,
  scopeConfirmedAt,
  scopeLocked,
  liveRfpCount,
  findings,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  propertyId: number;
  projectId: number;
  lines: ScopeLine[];
  /** Unit-turn scope is generated from a budget template with nothing to write
   *  prose about; common-area scope goes out to vendors who price from it. */
  requireDescriptions: boolean;
  /** Set once the scope is agreed as ready to price — pre-con gate 2. */
  scopeConfirmedAt: string | null;
  /** True once an RFP is out: vendors are pricing these lines, so they are frozen. */
  scopeLocked: boolean;
  /** How many vendors are pricing the live RFP, for the frozen-line note. */
  liveRfpCount: number;
  findings: PreWalkFinding[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const scopeLineCount = lines.length;
  const missingCode = lines.filter((l) => !l.costCodeName).length;
  // Mirrors confirmScopeRows: a unit turn's lines come from a budget template
  // with no prose to write, so only common-area scope is held to this.
  const missingDescription = requireDescriptions
    ? lines.filter((l) => !l.materialQuality?.trim()).length
    : 0;

  // What the lines actually add up to. Null lines contribute nothing, so an
  // uncosted scope totals zero rather than guessing at a number.
  const costed = lines.map(scopeLineTotal).filter((n): n is number => n != null);
  const scopeTotal = costed.reduce((a, b) => a + b, 0);
  const uncostedCount = lines.length - costed.length;

  // Confirming is gated on the scope being priced now, not on a number typed
  // beside it — the budget is derived from these very lines.
  const unpricedCount = lines.filter((l) => !l.quantity || !l.unitPrice).length;
  const budgetOk = unpricedCount === 0 && missingDescription === 0;

  const importable = findings.filter((f) => !f.inScope);
  // Default to all, as with every other bulk action here.
  const [picked, setPicked] = useState<Set<number>>(() => new Set(importable.map((f) => f.id)));

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
      // There is no budget to save alongside this any more — it is derived from
      // the lines being confirmed, so confirming them settles it.
      const res = await confirmScope({ projectId });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Scope confirmed — ready to send out for pricing");
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
                <div className={cn(SCOPE_GRID, "items-center border-b border-border px-3 py-1.5")}>
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
                      requireDescription={requireDescriptions}
                      liveRfpCount={liveRfpCount}
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
                      {scopeTotal > 0 ? moneyExact(scopeTotal) : "—"}
                    </span>
                    <span />
                  </div>

                  {/*
                    An "Approved budget" field sat here, with a note whenever it
                    disagreed with the scope total and a button to copy one into
                    the other. The disagreement cannot happen any more: the
                    budget IS the scope total. What is left is whether every line
                    has a price.
                  */}
                  {unpricedCount > 0 && (
                    <p className="mt-2 pl-8 text-[11.5px] text-gold">
                      {unpricedCount} line{unpricedCount === 1 ? "" : "s"} still need
                      {unpricedCount === 1 ? "s" : ""} a price. A vendor cannot quote a line with
                      no price on it.
                    </p>
                  )}
                </div>
              </div>
            )}

            {missingCode > 0 && (
              // Which lines is already visible below, flagged in red — this
              // adds the one thing the row can't say: where to go fix it. The
              // last moment it's cheap to; after the bid comes back the spend
              // has nowhere to reconcile to.
              <p className="flex items-start gap-1.5 text-[11.5px] text-alert">
                <AlertTriangleIcon className="mt-px size-3.5 shrink-0" />
                Lines flagged below have no budget category — set them on the project&apos;s Scope
                tab or the spend will not reconcile.
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
                    : unpricedCount > 0
                      ? "Every line needs a price before this can go out — that sum is what the bids get measured against."
                      : missingDescription > 0
                        ? "Every line needs a description before this can go out — a vendor prices from what is written."
                        : "Confirm when these lines are what you want priced."}
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
  requireDescription,
  liveRfpCount,
}: {
  index: number;
  line: ScopeLine;
  propertyId: number;
  projectId: number;
  locked: boolean;
  /** Common-area scope needs a sentence a vendor can price from; a unit
   *  turn's lines come from a budget template with nothing to write. */
  requireDescription: boolean;
  liveRfpCount: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [item, setItem] = useState(line.item);
  const [quantity, setQuantity] = useState(line.quantity ?? "");
  const [unitPrice, setUnitPrice] = useState(line.unitPrice ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const description = line.materialQuality?.trim() ?? "";

  // Off the edited values, not the saved ones, so the number moves as you type.
  const total = scopeLineTotal({ quantity: quantity || null, unitPrice: unitPrice || null });

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
    <div className="px-3 py-2">
      {/* Budget category on its own line, so the priced row below it can
          center its cells against each other instead of against a label
          only the item column carries. */}
      <div className={cn(SCOPE_GRID, "items-start")}>
        <span />
        <div className="truncate text-[10px] font-semibold tracking-[0.05em] text-ink-300">
          {line.costCodeName ? (
            <span className="text-ink-400">Budget category: {line.costCodeName}</span>
          ) : (
            <span className="font-bold text-alert">NO BUDGET CATEGORY</span>
          )}
        </div>
        <span />
        <span />
        <span />
        <span />
      </div>

      {/* The priced line: index, name, qty, unit cost, total and delete are
          all one control's height, so centering them against each other
          (rather than against the label above) is what actually lines up. */}
      <div className={cn(SCOPE_GRID, "mt-1 items-center")}>
        <span className="text-[11px] tabular-nums text-ink-300">{index}</span>

        {locked ? (
          <span className="block truncate text-[13px] font-medium text-navy">{line.item}</span>
        ) : (
          <Input
            className="h-8 text-[13px]"
            value={item}
            disabled={pending}
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
            aria-label={`Line ${index} name`}
          />
        )}

        {locked ? (
          <span
            className={cn(
              "text-right text-[13px] tabular-nums",
              quantity ? "text-ink-700" : "text-ink-300",
            )}
          >
            {quantity || "—"}
          </span>
        ) : (
          <Input
            className="h-8 text-right text-[13px] tabular-nums"
            placeholder="Qty"
            inputMode="decimal"
            value={quantity}
            disabled={pending}
            onChange={(e) => setQuantity(e.target.value)}
            onBlur={() => {
              const next = quantity.trim();
              if (next === (line.quantity ?? "")) return;
              save({ quantity: next || null }, () => setQuantity(line.quantity ?? ""));
            }}
            aria-label={`Line ${index} quantity`}
          />
        )}

        {locked ? (
          <span
            className={cn(
              "text-right text-[13px] tabular-nums",
              unitPrice ? "text-ink-700" : "text-ink-300",
            )}
          >
            {unitPrice ? moneyExact(Number(unitPrice)) : "—"}
          </span>
        ) : (
          <Input
            className="h-8 text-right text-[13px] tabular-nums"
            placeholder="Unit $"
            inputMode="decimal"
            value={unitPrice}
            disabled={pending}
            onChange={(e) => setUnitPrice(e.target.value)}
            onBlur={() => {
              const next = unitPrice.trim();
              if (next === (line.unitPrice ?? "")) return;
              save({ unitPrice: next || null }, () => setUnitPrice(line.unitPrice ?? ""));
            }}
            aria-label={`Line ${index} unit cost`}
          />
        )}

        <span
          className={cn(
            "text-right text-[13px] tabular-nums",
            total == null ? "text-ink-300" : "text-ink-700",
          )}
        >
          {total == null ? "—" : moneyExact(total)}
        </span>

        <span className="text-right">
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

      {/* Description, on its own line below — same reasoning as the budget
          category line above it. */}
      <div className={cn(SCOPE_GRID, "mt-1 items-start")}>
        <span />
        <DescriptionEditor
          scopeItemId={line.id}
          propertyId={propertyId}
          projectId={projectId}
          value={line.materialQuality ?? ""}
          outForBid={locked}
          vendorsPricing={liveRfpCount}
        >
          {description ? (
            <p className="text-[12px] leading-relaxed text-ink-500">{description}</p>
          ) : (
            <span
              className={cn(
                "inline-block text-[11.5px] underline underline-offset-[3px] transition-colors",
                requireDescription
                  ? "text-alert/70 hover:text-alert"
                  : "text-ink-200 hover:text-ink-500",
              )}
            >
              {requireDescription ? "Add description (required)" : "Add description"}
            </span>
          )}
        </DescriptionEditor>
        <span />
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

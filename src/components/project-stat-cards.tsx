import type { ReactNode } from "react";

import { BudgetInlineEditor } from "@/components/budget-inline-editor";
import { Card } from "@/components/ui/card";
import { initials, money } from "@/lib/format";
import { cn } from "@/lib/utils";

/** How the vendor card reads, resolved by the page from the project and its scope. */
export type VendorSummary = {
  label: string;
  /** False for "Not assigned" and for a plain count like "3 vendors". */
  showAvatar: boolean;
  note: string;
};

const LABEL = "text-[10.5px] font-semibold uppercase tracking-[0.09em] text-ink-300";

function Stat({
  label,
  value,
  valueClassName,
  note,
  noteClassName,
  action,
}: {
  label: string;
  value: ReactNode;
  valueClassName?: string;
  note: string;
  noteClassName?: string;
  action?: ReactNode;
}) {
  return (
    <Card className="h-full gap-1.5 px-(--card-spacing)">
      <div className={LABEL}>{label}</div>
      <div
        className={cn(
          "truncate text-[22px] leading-tight font-semibold tracking-[-0.01em] text-navy tabular-nums",
          valueClassName,
        )}
      >
        {value}
      </div>
      <div className="mt-auto flex flex-col gap-1 pt-1">
        <div className={cn("truncate text-[11.5px] text-muted-foreground", noteClassName)}>{note}</div>
        {action}
      </div>
    </Card>
  );
}

/**
 * The four numbers that answer "where does this project stand" — what it may
 * cost, how much work is defined, what phase it is in, and who is doing it.
 *
 * This replaced a cost bar and two phase-clock tiles. The bar drew approved,
 * committed and actual on one axis; committed has no home here, so if the
 * paperwork and the spend come apart, the budget card shows the overrun but not
 * that it was never contracted.
 */
export function ProjectStatCards({
  projectId,
  approved,
  actual,
  bidRange,
  scopeCount,
  pricedCount,
  scopeTotal,
  phaseLabel,
  daysInPhase,
  gate,
  vendor,
}: {
  projectId: number;
  approved: number;
  actual: number;
  /** Low and high of the bids in — the live money question before a budget exists. */
  bidRange: { low: number; high: number } | null;
  scopeCount: number;
  pricedCount: number;
  scopeTotal: number;
  phaseLabel: string;
  daysInPhase: number | null;
  gate: { met: number; total: number } | null;
  vendor: VendorSummary;
}) {
  const overBudget = approved > 0 && actual > approved;

  const budgetNote = (() => {
    if (approved > 0) {
      if (actual <= 0) return "Nothing posted yet";
      return overBudget
        ? `${money(actual)} actual · ${money(actual - approved)} over`
        : `${money(actual)} actual · ${money(approved - actual)} left`;
    }
    if (bidRange) {
      return bidRange.high > bidRange.low
        ? `Bids in: ${money(bidRange.low)} – ${money(bidRange.high)}`
        : `Bid in: ${money(bidRange.low)}`;
    }
    return "No budget approved";
  })();

  const scopeNote =
    scopeCount === 0
      ? "None added yet"
      : `${pricedCount} of ${scopeCount} priced${scopeTotal > 0 ? ` · ${money(scopeTotal)} planned` : ""}`;

  const stageNote =
    [
      daysInPhase == null ? null : `${daysInPhase}d in this phase`,
      gate ? `${gate.met} of ${gate.total} gates met` : null,
    ]
      .filter(Boolean)
      .join(" · ") || "Final phase";

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <Stat
        label="Total budget"
        value={approved > 0 ? money(approved) : "Not set"}
        valueClassName={approved > 0 ? undefined : "text-ink-300"}
        note={budgetNote}
        noteClassName={overBudget ? "text-alert" : undefined}
        action={<BudgetInlineEditor projectId={projectId} approved={approved} />}
      />
      <Stat label="Scope items" value={scopeCount} note={scopeNote} />
      <Stat
        label="Current stage"
        value={phaseLabel}
        valueClassName="text-[17px]"
        note={stageNote}
        noteClassName={gate && gate.met === 0 ? "text-alert" : undefined}
      />
      <Stat
        label="Vendor"
        value={
          vendor.showAvatar ? (
            <span className="flex items-center gap-2">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-md border border-[#c3d3ec] bg-[#dde6f5] text-[10.5px] font-bold text-[#1b3a6b]">
                {initials(vendor.label)}
              </span>
              <span className="truncate">{vendor.label}</span>
            </span>
          ) : (
            vendor.label
          )
        }
        valueClassName={cn("text-[17px]", vendor.showAvatar ? undefined : "text-ink-300")}
        note={vendor.note}
      />
    </div>
  );
}

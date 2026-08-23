import { cn } from "@/lib/utils";
import { BudgetInlineEditor } from "@/components/budget-inline-editor";

// ---------------------------------------------------------------------------
// Approved, committed and actual on one axis.
//
// They were three tiles, and three tiles cannot show the relationship between
// them. A unit reading $12,906 approved / $11,308 committed / $13,286 actual is
// nearly $2,000 spent on work nobody contracted — you had to notice the third
// number was bigger than the second and subtract. Here it is a red bar.
// ---------------------------------------------------------------------------

const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;

export function ProjectCostBar({
  projectId,
  approved,
  committed,
  actual,
  /** Low and high of the bids in, for the pre-con state where nothing is committed. */
  bidRange,
}: {
  projectId: number;
  approved: number;
  committed: number;
  actual: number;
  bidRange: { low: number; high: number } | null;
}) {
  const overBudget = approved > 0 && actual > approved;
  // Spend that was never contracted. Distinct from over-budget and more
  // diagnostic: it means the paperwork and the money have come apart.
  const uncontracted = committed > 0 && actual > committed ? actual - committed : 0;

  // Nothing to draw a bar against yet. Says what it can rather than showing an
  // empty track — during pre-con that is the bids, which is the live question.
  if (approved <= 0) {
    return (
      <div>
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[13px] text-ink-600">Cost against budget</span>
          <span className="text-[12px] text-muted-foreground">
            {committed > 0 ? `${usd(committed)} committed` : "Nothing committed yet"}
          </span>
        </div>
        <div className="relative mt-2.5 h-[22px]">
          <div className="absolute inset-x-0 top-[7px] h-2 rounded-full border border-dashed border-border" />
          {bidRange && (
            <div
              className="absolute top-1 h-3.5 rounded-[3px] bg-navy/10"
              style={{ left: "42%", width: "28%" }}
            />
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
          {bidRange ? (
            <span className="text-navy">
              Bids in: {usd(bidRange.low)}
              {bidRange.high > bidRange.low ? ` – ${usd(bidRange.high)}` : ""}
            </span>
          ) : null}
          <span className="text-muted-foreground">No budget approved</span>
          <BudgetInlineEditor projectId={projectId} approved={approved} />
        </div>
      </div>
    );
  }

  // The track spans whichever is larger, so an overrun has somewhere to go and
  // the approved line lands where it actually falls rather than always at 100%.
  const span = Math.max(approved, actual, committed);
  const pct = (v: number) => `${Math.min(100, (v / span) * 100)}%`;
  const withinBudget = Math.min(actual, approved);

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] text-ink-600">Cost against budget</span>
        <span className={cn("text-[12px]", overBudget ? "text-alert" : "text-muted-foreground")}>
          {overBudget
            ? `${usd(actual - approved)} over`
            : `${usd(approved - actual)} of budget left`}
        </span>
      </div>

      <div className="relative mt-2.5 h-[22px]">
        <div className="absolute inset-x-0 top-[7px] h-2 rounded-full bg-track" />
        <div
          className="absolute top-[7px] left-0 h-2 rounded-l-full bg-ink-500"
          style={{ width: pct(withinBudget) }}
        />
        {overBudget && (
          <div
            className="absolute top-[7px] h-2 rounded-r-full bg-alert"
            style={{ left: pct(approved), width: pct(actual - approved) }}
          />
        )}
        {committed > 0 && (
          <div
            className="absolute top-0.5 w-px bg-navy"
            style={{ left: pct(committed), height: "18px" }}
            aria-hidden
          />
        )}
        <div
          className={cn("absolute top-0 w-px", overBudget ? "bg-alert" : "bg-ink-300")}
          style={{ left: pct(approved), height: "22px" }}
          aria-hidden
        />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
        <span className="text-ink-600">
          <span className="mr-1.5 inline-block h-px w-2 translate-y-[-3px] bg-navy" />
          Committed {committed > 0 ? usd(committed) : "not set"}
        </span>
        <span className="text-ink-600">
          <span
            className={cn(
              "mr-1.5 inline-block h-px w-2 translate-y-[-3px]",
              overBudget ? "bg-alert" : "bg-ink-300",
            )}
          />
          Approved {usd(approved)}
        </span>
        <span className={overBudget ? "text-alert" : "text-ink-600"}>Actual {usd(actual)}</span>
        <BudgetInlineEditor projectId={projectId} approved={approved} />
      </div>

      {uncontracted > 0 && (
        <div className="mt-2.5 border-t border-hairline pt-2.5 text-[12px] text-alert">
          {usd(uncontracted)} spent beyond what was contracted
        </div>
      )}
    </div>
  );
}

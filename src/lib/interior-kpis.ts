import type { KpiItem } from "@/components/ui/kpi-strip";
import { money } from "@/lib/format";

/**
 * The four figures at the top of Unit Upgrades.
 *
 * Deliberately one each of plan progress, current load, throughput and money
 * rather than four flavours of dollars — the screen below is a list of turns, so
 * the strip answers "are we executing the plan, what is moving right now, what
 * is finished, and what has it cost".
 *
 * Pure: the page fetches, this shapes. Keeps the arithmetic testable without a
 * database and keeps the empty-state wording in one place.
 */

export type InteriorKpiInput = {
  /** Every non-archived unit project on the property. */
  projects: {
    phase: string;
    budgetAmount: number;
    startDate: string | null;
    completeDate: string | null;
    /** Posted GL to date for this project. */
    reconciled: number;
  }[];
  /**
   * Units planned across all renovation types, from the same compute the Budget
   * pivot uses — so the two halves of the section cannot disagree about the plan.
   *
   * Null when that compute failed. Distinct from zero: "we could not read the
   * plan" and "nothing is planned" are different facts, and claiming the latter
   * when the former happened would misreport progress as complete.
   */
  plannedUnits: number | null;
};

const MS_PER_DAY = 86_400_000;

/**
 * money() renders zero as an em dash, which is right in a sparse table cell and
 * wrong here: on this strip $0 is a measurement — nothing reconciled yet — not
 * missing data. Fixed locally rather than in the shared formatter, which most of
 * the app's tables depend on for exactly the opposite reason.
 */
function kpiMoney(value: number): string {
  return value === 0 ? "$0" : money(value);
}

/** Whole days between two ISO dates, or null if either is missing or malformed. */
export function turnDays(start: string | null, complete: string | null): number | null {
  if (!start || !complete) return null;
  const a = new Date(`${start}T00:00:00`).getTime();
  const b = new Date(`${complete}T00:00:00`).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / MS_PER_DAY);
}

export function buildInteriorKpis({ projects, plannedUnits }: InteriorKpiInput): KpiItem[] {
  const started = projects.length;
  const inProcess = projects.filter((p) => p.phase === "in_process").length;
  const inPunch = projects.filter((p) => p.phase === "punch").length;
  const active = inProcess + inPunch;
  const complete = projects.filter((p) => p.phase === "complete");

  const budgeted = projects.reduce((n, p) => n + p.budgetAmount, 0);
  const reconciled = projects.reduce((n, p) => n + p.reconciled, 0);
  // Percent of the started turns' budget actually spent. Guarded because a
  // property whose turns are all still in pre-con has a zero budget.
  const spentPct = budgeted > 0 ? Math.round((reconciled / budgeted) * 100) : null;

  const days = complete
    .map((p) => turnDays(p.startDate, p.completeDate))
    .filter((d): d is number => d != null);
  const avgDays = days.length > 0 ? Math.round(days.reduce((a, b) => a + b, 0) / days.length) : null;

  // Turns started counts projects, not units: one project is one unit, and a
  // project existing at all is the commitment. Remaining can't go below zero —
  // starting more turns than planned is over-delivery, not a negative backlog.
  const remaining = plannedUnits != null ? Math.max(0, plannedUnits - started) : null;

  return [
    {
      label: "Turns started",
      value: plannedUnits != null && plannedUnits > 0 ? `${started} of ${plannedUnits}` : String(started),
      delta:
        plannedUnits == null
          ? "plan unavailable"
          : plannedUnits > 0
            ? remaining! > 0
              ? `${remaining!.toLocaleString()} remaining in plan`
              : "plan fully started"
            : "no units planned yet",
      deltaVariant: plannedUnits != null && plannedUnits > 0 && remaining === 0 ? "positive" : "muted",
    },
    {
      label: "In progress",
      // Both counts when both are non-zero: reporting only punch left the
      // in-process turns making up the rest of the headline unaccounted for.
      value: String(active),
      delta:
        active === 0
          ? "nothing under way"
          : [
              inProcess > 0 ? `${inProcess} in process` : null,
              inPunch > 0 ? `${inPunch} in punch` : null,
            ]
              .filter(Boolean)
              .join(" · "),
      deltaVariant: active > 0 ? "pending" : "muted",
    },
    {
      label: "Complete",
      value: String(complete.length),
      delta:
        complete.length === 0
          ? "none finished yet"
          : avgDays != null
            ? `avg ${avgDays} day${avgDays === 1 ? "" : "s"} to turn`
            : // Completed but undated: say so rather than showing a blank, since
              // the figure is missing data and not a zero.
              "no start/finish dates recorded",
      deltaVariant: complete.length > 0 ? "positive" : "muted",
    },
    {
      label: "Budgeted vs actual",
      value: kpiMoney(budgeted),
      delta:
        spentPct != null
          ? `${kpiMoney(reconciled)} reconciled · ${spentPct}%`
          : `${kpiMoney(reconciled)} reconciled`,
      deltaVariant: "muted",
    },
  ];
}

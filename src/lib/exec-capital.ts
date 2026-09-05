/**
 * Capital views for the executive dashboard, computed from real project data.
 *
 * Pure: takes rows, returns shapes to plot. The DB side lives in
 * exec-capital-data.ts so this can be exercised without a database.
 */

export type ProjectRow = {
  id: number;
  name: string;
  kind: "unit" | "common";
  phase: "precon" | "in_process" | "punch" | "complete";
  budget: number;
  /** Cost category name; null when the project carries no cost code. */
  category: string | null;
  /** Planned milestone dates, ISO. */
  preconDate: string | null;
  inProcessDate: string | null;
  completeDate: string | null;
  /** Actual start, when work has really begun. */
  startDate: string | null;
};

export const PHASES = [
  { key: "precon", label: "Pre-construction" },
  { key: "in_process", label: "In process" },
  { key: "punch", label: "Punch" },
  { key: "complete", label: "Complete" },
] as const;
export type PhaseKey = (typeof PHASES)[number]["key"];

/** Unit turns have no cost code of their own; their capital is interior work. */
const INTERIORS = "Interiors";
const UNCATEGORISED = "Uncategorised";
/** Seven is the categorical palette's validated adjacent run; the tail folds in. */
const MAX_SERIES = 7;
const OTHER = "Other";

export function categoryOf(p: ProjectRow): string {
  if (p.category) return p.category;
  return p.kind === "unit" ? INTERIORS : UNCATEGORISED;
}

export type PhaseStack = {
  phase: PhaseKey;
  label: string;
  total: number;
  /** Amount per category, aligned to `categories` order. */
  values: number[];
};

export type CapitalByPhase = {
  categories: string[];
  stacks: PhaseStack[];
  total: number;
};

/**
 * Capital sitting in each phase, split by cost category.
 *
 * Categories are ranked by total and the tail folded into "Other" rather than
 * cycling hues past the palette's validated run — an eighth colour would be a
 * guess, and on a stacked bar a guessed hue is indistinguishable from a real one.
 */
export function capitalByPhase(projects: ProjectRow[]): CapitalByPhase {
  const totals = new Map<string, number>();
  for (const p of projects) {
    const c = categoryOf(p);
    totals.set(c, (totals.get(c) ?? 0) + p.budget);
  }

  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  const kept = ranked.slice(0, MAX_SERIES - (ranked.length > MAX_SERIES ? 1 : 0));
  const categories = ranked.length > MAX_SERIES ? [...kept, OTHER] : kept;
  const index = new Map(categories.map((c, i) => [c, i]));
  const slotFor = (c: string) => index.get(c) ?? index.get(OTHER)!;

  const stacks: PhaseStack[] = PHASES.map((ph) => {
    const values = new Array(categories.length).fill(0);
    let total = 0;
    for (const p of projects) {
      if (p.phase !== ph.key) continue;
      values[slotFor(categoryOf(p))] += p.budget;
      total += p.budget;
    }
    return { phase: ph.key, label: ph.label, total, values };
  });

  return { categories, stacks, total: projects.reduce((s, p) => s + p.budget, 0) };
}

// ---------------------------------------------------------------------------
// Deployment curve
// ---------------------------------------------------------------------------

export type CurvePoint = {
  month: string; // YYYY-MM
  label: string; // "Jan 26"
  underwritten: number; // cumulative
  scheduled: number; // cumulative
};

export type DeploymentCurve = {
  points: CurvePoint[];
  /** Index of the month containing `today`, or -1 when it falls outside. */
  todayIndex: number;
  budgetTotal: number;
  scheduledTotal: number;
  /** Projects with no usable dates, so absent from the scheduled curve. */
  undatedCount: number;
  undatedAmount: number;
};

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

function labelFor(key: string): string {
  const [y, m] = key.split("-");
  return `${MONTH_NAMES[Number(m) - 1]} ${y.slice(2)}`;
}

function addMonths(key: string, n: number): string {
  const [y, m] = key.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${String(Math.floor(total / 12)).padStart(4, "0")}-${String((total % 12) + 1).padStart(2, "0")}`;
}

function monthSpan(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = from;
  // Guard rather than trust the inputs: a bad date pair would otherwise spin.
  for (let i = 0; i < 600 && cur <= to; i++) {
    out.push(cur);
    cur = addMonths(cur, 1);
  }
  return out;
}

/** The window a project's spend is spread across, widest usable pair of dates. */
function projectSpan(p: ProjectRow): { from: string; to: string } | null {
  const start = p.preconDate ?? p.startDate ?? p.inProcessDate ?? p.completeDate;
  const end = p.completeDate ?? p.inProcessDate ?? p.startDate ?? p.preconDate;
  if (!start || !end) return null;
  return start <= end ? { from: monthKey(start), to: monthKey(end) } : { from: monthKey(end), to: monthKey(start) };
}

/**
 * Two cumulative curves.
 *
 * `underwritten` is the naive plan — the whole budget drawn down in equal
 * monthly slices over `spreadMonths`. Nobody underwrote a month-by-month
 * schedule, so a straight line is the honest stand-in for one, and it exists to
 * be compared against, not believed.
 *
 * `scheduled` is what the projects actually say: each project's budget spread
 * evenly from its pre-construction date through completion, summed and
 * accumulated. Where it lands short of the budget total, the difference is
 * capital not yet scoped into any project — which is the point of showing them
 * on one axis.
 */
export function deploymentCurve(
  projects: ProjectRow[],
  budgetTotal: number,
  today: string,
  spreadMonths = 24,
): DeploymentCurve {
  const spans = projects.map((p) => ({ p, span: projectSpan(p) }));
  const dated = spans.filter((s): s is { p: ProjectRow; span: { from: string; to: string } } => s.span !== null);

  const todayMonth = monthKey(today);
  const starts = dated.map((s) => s.span.from);
  const first = starts.length > 0 ? starts.reduce((a, b) => (a < b ? a : b)) : todayMonth;

  const ends = dated.map((s) => s.span.to);
  const lastProject = ends.length > 0 ? ends.reduce((a, b) => (a > b ? a : b)) : todayMonth;
  const lastUnderwritten = addMonths(first, spreadMonths - 1);
  const last = lastProject > lastUnderwritten ? lastProject : lastUnderwritten;

  const months = monthSpan(first, last);
  const slot = new Map(months.map((m, i) => [m, i]));

  // Per-month scheduled spend, before accumulating.
  const monthly = new Array(months.length).fill(0);
  for (const { p, span } of dated) {
    const ms = monthSpan(span.from, span.to);
    if (ms.length === 0) continue;
    const each = p.budget / ms.length;
    for (const m of ms) {
      const i = slot.get(m);
      if (i != null) monthly[i] += each;
    }
  }

  const perMonthUw = spreadMonths > 0 ? budgetTotal / spreadMonths : 0;
  let running = 0;
  const points: CurvePoint[] = months.map((m, i) => {
    running += monthly[i];
    return {
      month: m,
      label: labelFor(m),
      underwritten: Math.min(budgetTotal, perMonthUw * (i + 1)),
      scheduled: running,
    };
  });

  const undated = spans.filter((s) => s.span === null);
  return {
    points,
    todayIndex: slot.get(todayMonth) ?? -1,
    budgetTotal,
    scheduledTotal: running,
    undatedCount: undated.length,
    undatedAmount: undated.reduce((s, x) => s + x.p.budget, 0),
  };
}

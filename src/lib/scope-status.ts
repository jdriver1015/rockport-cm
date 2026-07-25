/**
 * Per-scope-line progress. Rolls up by trade category on the project dashboard
 * so a PM can see "Demo complete, Flooring in progress" at a glance.
 */
export const SCOPE_STATUSES = [
  { key: "not_started", label: "Not started" },
  { key: "in_progress", label: "In progress" },
  { key: "complete", label: "Complete" },
  { key: "blocked", label: "Blocked" },
] as const;

export type ScopeStatusKey = (typeof SCOPE_STATUSES)[number]["key"];

export const SCOPE_STATUS_KEYS = SCOPE_STATUSES.map((s) => s.key) as ScopeStatusKey[];

export function scopeStatusLabel(key: string): string {
  return SCOPE_STATUSES.find((s) => s.key === key)?.label ?? key;
}

/** Text color per status — blocked reads as an alert, complete as realized. */
export const SCOPE_STATUS_COLOR: Record<ScopeStatusKey, string> = {
  not_started: "text-ink-400",
  in_progress: "text-info",
  complete: "text-positive",
  blocked: "text-alert",
};

export type ScopeProgress = {
  total: number;
  complete: number;
  inProgress: number;
  blocked: number;
  /** Scope dollars on complete lines, and the group's total — the weighted view */
  completeValue: number;
  totalValue: number;
};

/**
 * Roll a set of lines into a progress summary. Progress is reported as
 * completed dollars over total dollars — dollar-weighted rather than a raw
 * line count, so a $6k floor doesn't count the same as a $40 icemaker line.
 */
export function rollUpScope(
  lines: { status: string; quantity: number | null; unitPrice: number | null }[],
): ScopeProgress {
  let complete = 0;
  let inProgress = 0;
  let blocked = 0;
  let completeValue = 0;
  let totalValue = 0;

  for (const l of lines) {
    const value = (l.quantity ?? 0) * (l.unitPrice ?? 0);
    totalValue += value;
    if (l.status === "complete") {
      complete++;
      completeValue += value;
    } else if (l.status === "in_progress") inProgress++;
    else if (l.status === "blocked") blocked++;
  }

  return { total: lines.length, complete, inProgress, blocked, completeValue, totalValue };
}

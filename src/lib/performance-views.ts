/**
 * The Performance tab's two views. Lives outside the client component so the
 * page (a Server Component) can parse the search param without importing across
 * the client boundary — the same split budget-views.ts uses.
 *
 * "performance" is the default: the rent rolls are the input, and how the turn
 * programme is actually doing is the thing worth opening the tab for.
 */
export const PERFORMANCE_VIEWS = ["performance", "rent-rolls"] as const;

export type PerformanceViewKey = (typeof PERFORMANCE_VIEWS)[number];

export function parsePerformanceView(value: string | undefined): PerformanceViewKey {
  return PERFORMANCE_VIEWS.includes(value as PerformanceViewKey)
    ? (value as PerformanceViewKey)
    : "performance";
}

/**
 * The Budget tab's three views. Lives outside the client component so the page
 * (a Server Component) can parse the search param without importing across the
 * client boundary.
 */
export const BUDGET_VIEWS = ["consolidated", "exterior", "interior"] as const;

export type BudgetViewKey = (typeof BUDGET_VIEWS)[number];

export function parseBudgetView(value: string | undefined): BudgetViewKey {
  return BUDGET_VIEWS.includes(value as BudgetViewKey) ? (value as BudgetViewKey) : "consolidated";
}

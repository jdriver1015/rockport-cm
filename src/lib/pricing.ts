/**
 * Interior renovation pricing engine.
 *
 * Pure and dependency-free so it runs identically on the server (generating a
 * project's scope) and the client (the wizard's live review step). Each pricing
 * method is one entry in a registry keyed by method name — adding a new method
 * is a one-line addition, not an edit to a branching switch. That's what keeps
 * the engine "extensible rather than hardcoded."
 *
 * A line's quantity comes from the method + the unit's metadata; the total is
 * always quantity × unitPrice (except `percent`, which is a share of a base).
 */

export const PRICING_METHODS = [
  "sqft",
  "fixed",
  "per_bedroom",
  "per_bathroom",
  "per_window",
  "per_cabinet",
  "percent",
  "formula",
] as const;

export type PricingMethod = (typeof PRICING_METHODS)[number];

export const PRICING_METHOD_LABELS: Record<PricingMethod, string> = {
  sqft: "Per square foot",
  fixed: "Fixed cost",
  per_bedroom: "Per bedroom",
  per_bathroom: "Per bathroom",
  per_window: "Per window",
  per_cabinet: "Per cabinet",
  percent: "Percentage of base",
  formula: "Custom formula",
};

/** Unit attributes the engine can price against. Missing values are treated as null. */
export type UnitMeta = {
  sqft?: number | null;
  bedrooms?: number | null;
  baths?: number | null;
  /** Not tracked in the rent roll yet — engine falls back to defaultQuantity. */
  windows?: number | null;
  cabinets?: number | null;
};

export type PricingInput = {
  method: PricingMethod;
  unitPrice: number;
  /** Manual quantity fallback for methods with no unit-derived source */
  defaultQuantity?: number | null;
  /** Expression for method='formula' */
  quantityFormula?: string | null;
  /** Base amount for method='percent' (e.g. sum of the other lines) */
  percentBase?: number | null;
};

export type PricingResult = {
  quantity: number;
  total: number;
  /** Set when the engine had to fall back (e.g. missing metadata) — surfaced in review */
  note?: string;
};

const n = (v: number | null | undefined): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0;

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Evaluate a quantity formula over unit attributes. Deliberately tiny and safe:
 * known variable tokens are substituted with numbers, then the result must be
 * pure arithmetic before it is evaluated. Anything else yields 0 + a note.
 */
export function evalQuantityFormula(
  formula: string,
  unit: UnitMeta,
): { value: number; note?: string } {
  const vars: Record<string, number> = {
    sqft: n(unit.sqft),
    squarefeet: n(unit.sqft),
    sf: n(unit.sqft),
    bedrooms: n(unit.bedrooms),
    beds: n(unit.bedrooms),
    br: n(unit.bedrooms),
    baths: n(unit.baths),
    bathrooms: n(unit.baths),
    ba: n(unit.baths),
    windows: n(unit.windows),
    cabinets: n(unit.cabinets),
  };

  let expr = formula.toLowerCase();
  // Replace longest variable names first so "squarefeet" isn't clipped by "sf".
  for (const key of Object.keys(vars).sort((a, b) => b.length - a.length)) {
    expr = expr.replace(new RegExp(`\\b${key}\\b`, "g"), String(vars[key]));
  }

  if (!/^[0-9+\-*/(). ]+$/.test(expr)) {
    return { value: 0, note: "Formula has unknown terms — set the quantity manually" };
  }
  try {
    const value = Number(new Function(`return (${expr});`)());
    if (!Number.isFinite(value)) return { value: 0, note: "Formula did not resolve to a number" };
    return { value };
  } catch {
    return { value: 0, note: "Formula could not be evaluated" };
  }
}

type PricingFn = (unit: UnitMeta, input: PricingInput) => PricingResult;

/** The registry. Add a method by adding one entry here. */
const ENGINE: Record<PricingMethod, PricingFn> = {
  sqft: (unit, input) => {
    const quantity = n(unit.sqft);
    return {
      quantity,
      total: roundMoney(quantity * input.unitPrice),
      note: unit.sqft == null ? "Unit has no square footage on file" : undefined,
    };
  },
  fixed: (_unit, input) => ({ quantity: 1, total: roundMoney(input.unitPrice) }),
  per_bedroom: (unit, input) => {
    const quantity = n(unit.bedrooms);
    return {
      quantity,
      total: roundMoney(quantity * input.unitPrice),
      note: unit.bedrooms == null ? "Unit has no bedroom count on file" : undefined,
    };
  },
  per_bathroom: (unit, input) => {
    const quantity = n(unit.baths);
    return {
      quantity,
      total: roundMoney(quantity * input.unitPrice),
      note: unit.baths == null ? "Unit has no bathroom count on file" : undefined,
    };
  },
  per_window: (unit, input) => {
    const tracked = unit.windows != null;
    const quantity = tracked ? n(unit.windows) : n(input.defaultQuantity);
    return {
      quantity,
      total: roundMoney(quantity * input.unitPrice),
      note: tracked ? undefined : "Window count not tracked — using default quantity",
    };
  },
  per_cabinet: (unit, input) => {
    const tracked = unit.cabinets != null;
    const quantity = tracked ? n(unit.cabinets) : n(input.defaultQuantity);
    return {
      quantity,
      total: roundMoney(quantity * input.unitPrice),
      note: tracked ? undefined : "Cabinet count not tracked — using default quantity",
    };
  },
  percent: (_unit, input) => {
    const base = n(input.percentBase);
    return {
      quantity: 1,
      total: roundMoney((input.unitPrice / 100) * base),
      note: input.percentBase == null ? "No base amount — percentage applied to 0" : undefined,
    };
  },
  formula: (unit, input) => {
    if (!input.quantityFormula?.trim()) {
      const quantity = n(input.defaultQuantity);
      return { quantity, total: roundMoney(quantity * input.unitPrice), note: "No formula set — using default quantity" };
    }
    const { value, note } = evalQuantityFormula(input.quantityFormula, unit);
    return { quantity: value, total: roundMoney(value * input.unitPrice), note };
  },
};

/** Price a single scope line against a unit. Unknown methods fall back to fixed. */
export function priceLine(input: PricingInput, unit: UnitMeta): PricingResult {
  const fn = ENGINE[input.method] ?? ENGINE.fixed;
  return fn(unit, input);
}

/** Sum the totals of many lines (e.g. to seed a project's budgetAmount). */
export function scopeTotal(results: Pick<PricingResult, "total">[]): number {
  return roundMoney(results.reduce((s, r) => s + n(r.total), 0));
}

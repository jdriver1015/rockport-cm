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
      // A zero base is just as silent as a missing one — both yield $0 — so warn
      // on either rather than only on null.
      note:
        input.percentBase == null
          ? "No base amount — percentage applied to 0"
          : base === 0
            ? "Base amount is 0 — percentage yields nothing"
            : undefined,
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

// ---------------------------------------------------------------------------
// Group pricing — pricing a whole tier against one unit (or one unit group).
//
// This exists so the `percent` base is computed in exactly ONE place. Three
// callers need the same answer — the interior wizard, the budget pivot, and the
// portfolio rollup — and if any of them derived the base differently the pivot
// and the project it created would disagree. Do not recompute a base elsewhere.
// ---------------------------------------------------------------------------

/** The minimum a line must expose to be priced. Callers pass richer objects. */
export type GroupPricingLine = {
  costCodeId: number;
  pricingMethod: PricingMethod;
  unitPrice: number;
  defaultQuantity?: number | null;
  quantityFormula?: string | null;
};

/**
 * A pinned amount overriding the derived total for one cost code. Already
 * scoped by the caller to a single (tier, unit group) pair, so the cost code
 * alone identifies it.
 */
export type GroupPricingPin = { costCodeId: number; amount: number };

export type PricedGroupLine<T> = {
  line: T;
  quantity: number;
  /** Effective unit price. Invariant: quantity × unitPrice === total. */
  unitPrice: number;
  total: number;
  /** True when a pin replaced the derived amount. */
  pinned: boolean;
  note?: string;
};

export type GroupPricing<T> = {
  perLine: PricedGroupLine<T>[];
  /** Σ non-percent lines. This is the percent base — nothing else may serve as one. */
  subtotal: number;
  /** Σ percent lines. */
  softCosts: number;
  /** subtotal + softCosts. Plan-level CM/contingency uplifts apply on top of this. */
  grandTotal: number;
};

/**
 * Price every line in a tier against one unit's metadata, applying pins.
 *
 * Two passes, because percent lines need the others' sum: non-percent lines are
 * priced first to establish `subtotal`, then percent lines are priced against
 * it. Percent lines therefore never compound on each other and are
 * order-independent.
 *
 * A pin replaces the derived total outright and reports `quantity: 1` — a pin is
 * a dollar amount, never a rate, so it must not be multiplied by square footage.
 */
export function resolveGroupPricing<T extends GroupPricingLine>({
  lines,
  unit,
  pins,
}: {
  lines: readonly T[];
  unit: UnitMeta;
  pins?: readonly GroupPricingPin[];
}): GroupPricing<T> {
  const pinByCode = new Map<number, number>();
  for (const p of pins ?? []) pinByCode.set(p.costCodeId, p.amount);

  const price = (line: T, percentBase: number | null): PricedGroupLine<T> => {
    const pin = pinByCode.get(line.costCodeId);
    if (pin != null) {
      const total = roundMoney(pin);
      return { line, quantity: 1, unitPrice: total, total, pinned: true };
    }
    const res = priceLine(
      {
        method: line.pricingMethod,
        unitPrice: line.unitPrice,
        defaultQuantity: line.defaultQuantity,
        quantityFormula: line.quantityFormula,
        percentBase,
      },
      unit,
    );
    // Percent lines carry their resolved dollars as the unit price at quantity 1
    // so the qty × price invariant holds for callers that persist both.
    const isPercent = line.pricingMethod === "percent";
    return {
      line,
      quantity: isPercent ? 1 : res.quantity,
      unitPrice: isPercent ? res.total : line.unitPrice,
      total: res.total,
      pinned: false,
      note: res.note,
    };
  };

  const base: PricedGroupLine<T>[] = [];
  const percentLines: T[] = [];
  for (const line of lines) {
    if (line.pricingMethod === "percent") percentLines.push(line);
    else base.push(price(line, null));
  }

  const subtotal = scopeTotal(base);
  const soft = percentLines.map((line) => price(line, subtotal));
  const softCosts = scopeTotal(soft);

  // Preserve the caller's original line order rather than base-then-percent.
  const byLine = new Map<T, PricedGroupLine<T>>();
  for (const r of [...base, ...soft]) byLine.set(r.line, r);
  const perLine = lines.map((l) => byLine.get(l)!).filter(Boolean);

  return { perLine, subtotal, softCosts, grandTotal: roundMoney(subtotal + softCosts) };
}

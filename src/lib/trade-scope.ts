/**
 * The trades a unit interior scope is written against, in the order they appear
 * on Drew's scope template — roughly the order the work happens in, which is
 * also the order a GC reads and prices it.
 *
 * A list in code rather than rows in a table: these are the portfolio's standard
 * headings, they change about never, and having them here means every renovation
 * type shows all thirteen with the unwritten ones visible as gaps. Stored rows
 * exist only for scopes actually written, plus any custom heading a property
 * adds — so an empty type costs no rows, and "what's missing" is a fact about
 * the list rather than something to keep in sync.
 */
export const TRADE_HEADINGS = [
  "Demolition",
  "Paint",
  "Flooring",
  "Cabinets",
  "Countertops",
  "Kitchen backsplash",
  "Plumbing fixtures",
  "Bath accessories",
  "Light fixtures",
  "Electrical",
  "Door hardware",
  "Appliances",
  "Final clean",
] as const;

export type TradeScopeRow = {
  id: number;
  heading: string;
  body: string | null;
  sortOrder: number;
};

export type TradeScopeEntry = {
  heading: string;
  /** Null when nothing has been written for this trade yet. */
  body: string | null;
  /** Absent until something is saved — there is no row to edit or delete. */
  id: number | null;
  /** True for a heading the property added beyond the standard thirteen. */
  custom: boolean;
};

/**
 * The canonical thirteen in standard order, each carrying whatever has been
 * written for it, followed by any custom headings.
 *
 * Custom rows sort after the standard list rather than by sortOrder alone: a
 * reader comparing two renovation types needs the shared trades to line up, and
 * a property's extra trade is by definition not part of that comparison.
 */
export function mergeTradeScopes(rows: TradeScopeRow[]): TradeScopeEntry[] {
  const byHeading = new Map(rows.map((r) => [r.heading, r]));

  const standard: TradeScopeEntry[] = TRADE_HEADINGS.map((heading) => {
    const row = byHeading.get(heading);
    return {
      heading,
      body: row?.body ?? null,
      id: row?.id ?? null,
      custom: false,
    };
  });

  const known = new Set<string>(TRADE_HEADINGS);
  const custom = rows
    .filter((r) => !known.has(r.heading))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.heading.localeCompare(b.heading))
    .map((r) => ({ heading: r.heading, body: r.body, id: r.id, custom: true }));

  return [...standard, ...custom];
}

/** A scope counts as written once it has non-whitespace text. */
export function isWritten(entry: TradeScopeEntry): boolean {
  return !!entry.body && entry.body.trim().length > 0;
}

/** "9 of 13 written" — the completeness figure shown beside the section. */
export function writtenCount(entries: TradeScopeEntry[]): { written: number; total: number } {
  return { written: entries.filter(isWritten).length, total: entries.length };
}

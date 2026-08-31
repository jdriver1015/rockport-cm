/**
 * Pure helpers for importing a property's budget from a spreadsheet. No DB or
 * server-only deps, mirroring chart-import.ts: a server action calls these to
 * parse, and the same functions could re-derive a preview client-side if the
 * user corrects anything, without a round trip.
 *
 * Built to read TWO different shapes, because the workbook this is meant to
 * accept is not always one this app produced. An underwriter's own capex
 * budget — the real one this was designed against has no "Cost Code" column
 * at all, just an Item name next to an amount, with section headers
 * ("Landscaping") and "Subtotal - X" rows mixed into the same column as real
 * line items. This app's own export (budget-export.ts) DOES carry a Cost Code
 * column, which is matched first when present because it is authoritative —
 * a name can be renamed or duplicated, a code cannot.
 */

export type BudgetColumnRole = "item" | "amount" | "code" | "category" | "notes";

/** Detected/selected column index per role, -1 = not mapped. */
export type BudgetColumnMapping = Record<BudgetColumnRole, number>;

export const BUDGET_COLUMN_ROLES: { key: BudgetColumnRole; label: string; required?: boolean }[] = [
  { key: "item", label: "Item / description", required: true },
  { key: "amount", label: "Amount", required: true },
  { key: "code", label: "Cost code" },
  { key: "category", label: "Category" },
  { key: "notes", label: "Notes" },
];

// Ordered by preference within a role: "total" beats "year 1" when a workbook
// carries a multi-year phasing table, because Total is the one number that
// means the same thing regardless of how many year columns exist.
const HEADER_HINTS: Record<BudgetColumnRole, string[]> = {
  item: ["item", "description", "line item", "name"],
  amount: ["total", "approved", "uw amount", "amount", "budget", "budgeted", "year 1"],
  code: ["cost code", "code"],
  category: ["category", "division"],
  notes: ["notes", "note"],
};

export function normHeader(s: unknown): string {
  return String(s ?? "").trim().toLowerCase();
}

/**
 * The first row where BOTH required roles resolve, not the first non-blank
 * row.
 *
 * A real capex workbook opens with a title and a property name above its
 * actual header — "Aston Post Oak", then "CAPITAL BUDGET - EXTERIOR", then
 * the row that actually says Item/Quantity/Unit Price/Total. Assuming the
 * header is whatever comes first read that title row as the header and found
 * zero columns, because "Aston Post Oak" is one cell with nothing beside it
 * to detect as an amount column.
 *
 * Stops at the first match — a workbook is not scanned indefinitely, and
 * returning -1 when nothing in the first few dozen rows works is a clearer
 * failure than silently treating some later coincidental row as the header.
 */
export function findBudgetHeaderRow(grid: string[][], maxScan = 30): number {
  for (let i = 0; i < Math.min(grid.length, maxScan); i++) {
    const row = grid[i];
    if (!row.some((c) => c !== "")) continue;
    const mapping = detectBudgetMapping(row);
    if (mapping.item >= 0 && mapping.amount >= 0) return i;
  }
  return -1;
}

export function detectBudgetMapping(headers: string[]): BudgetColumnMapping {
  const find = (hints: string[]) => {
    for (const hint of hints) {
      const i = headers.findIndex((h) => normHeader(h) === hint);
      if (i >= 0) return i;
    }
    for (const hint of hints) {
      const i = headers.findIndex((h) => normHeader(h).includes(hint));
      if (i >= 0) return i;
    }
    return -1;
  };
  return {
    item: find(HEADER_HINTS.item),
    amount: find(HEADER_HINTS.amount),
    code: find(HEADER_HINTS.code),
    category: find(HEADER_HINTS.category),
    notes: find(HEADER_HINTS.notes),
  };
}

export type BudgetImportRow = {
  item: string;
  amount: number;
  code: string | null;
  category: string | null;
  notes: string | null;
};

/** "Subtotal - Exterior", "TOTAL", "Grand Total" — derived rows, never a real line. */
const NON_ITEM = /^\s*(sub)?total\b|^\s*grand total\b/i;

// A lone dash is a standard accounting convention for zero — a three-part
// Excel number format like `"$"#,##0;("$"#,##0);"-"` renders the zero case as
// this literal string. Aston's own exterior workbook uses it: Foundation,
// Parking Lot, Tree Trimming, Drainage and Railings are all real $0 line
// items formatted this way, and without this they parsed as unparseable and
// silently vanished — indistinguishable from a section-header row that has
// nothing in the amount column at all.
const ZERO_DASH = /^[-‒–—]$/;

/**
 * A number cell read through a spreadsheet library's `raw: false` mode comes
 * back "0" (or a formatted dash, see above) for a genuine zero and "" for
 * truly blank — the one distinction that tells a real line item apart from a
 * section header ("Landscaping", which has nothing in any numeric column at
 * all). Anything else not cleanly a number is treated as blank rather than
 * guessed at.
 */
function parseAmount(raw: string): number | null {
  const t = raw.trim();
  if (t === "") return null;
  if (ZERO_DASH.test(t)) return 0;
  const n = Number(t.replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Turn a grid body + column mapping into budget rows.
 *
 * Skipped, not reported as unresolved: a blank item, a subtotal/total row, and
 * a row with no parseable amount at all (a genuine section-header divider).
 * Those are structural, not data — surfacing them as "could not match" would
 * bury the rows that actually need a person's attention.
 */
export function budgetRowsFromGrid(grid: string[][], mapping: BudgetColumnMapping): BudgetImportRow[] {
  const out: BudgetImportRow[] = [];
  for (const row of grid) {
    const cell = (i: number) => (i >= 0 ? String(row[i] ?? "").trim() : "");
    const item = cell(mapping.item);
    if (!item || NON_ITEM.test(item)) continue;

    const amount = mapping.amount >= 0 ? parseAmount(cell(mapping.amount)) : null;
    if (amount === null) continue;

    out.push({
      item,
      amount,
      code: cell(mapping.code) || null,
      category: cell(mapping.category) || null,
      notes: cell(mapping.notes) || null,
    });
  }
  return out;
}

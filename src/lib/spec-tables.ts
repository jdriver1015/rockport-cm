/**
 * Finish specs and the fixture kit — the tables a GC orders from. Pure shapes and
 * presets; the database work is in src/lib/spec-tables-store.ts.
 */

export const SPEC_KINDS = ["finish", "fixture"] as const;
export type SpecKind = (typeof SPEC_KINDS)[number];

export const SPEC_KIND_LABELS: Record<SpecKind, string> = {
  finish: "Finish specs",
  fixture: "Fixture kit",
};

export type SpecGrid = { cols: string[]; rows: string[][] };

export type SpecTable = {
  id: number;
  kind: SpecKind;
  title: string;
  grid: SpecGrid;
  sortOrder: number;
  /**
   * Version token for the save. Sent back on write so a grid edited by someone
   * else in the meantime is refused rather than silently overwritten — the
   * editor keeps a local draft, so without this the second writer's stale copy
   * simply replaced the first's work.
   */
  version: number;
};

/**
 * The standard tables, offered when adding one rather than seeded onto every
 * type.
 *
 * Unlike the trade headings — which are always all thirteen, because a missing
 * trade is meaningful — a spec table with no rows says nothing. So these are
 * presets: they supply the columns, which is the part nobody should have to
 * retype, and the rows are the actual specification work.
 */
export const SPEC_PRESETS: { kind: SpecKind; title: string; cols: string[] }[] = [
  { kind: "finish", title: "Paint", cols: ["Area", "Color", "Product", "Color #", "Sheen"] },
  { kind: "finish", title: "Flooring", cols: ["Area", "Spec"] },
  { kind: "finish", title: "Countertops & misc", cols: ["Item", "Spec", "Product"] },
  { kind: "finish", title: "Appliances", cols: ["Item", "Product", "Model #"] },
  { kind: "fixture", title: "Fixtures", cols: ["Item", "Spec", "Vendor", "Model #", "Notes"] },
];

export function emptyGrid(cols: string[]): SpecGrid {
  return { cols, rows: [] };
}

/**
 * Coerce a stored grid into a rectangle.
 *
 * Rows are padded and truncated to the column count on read rather than trusted:
 * jsonb accepts any shape, columns can be added or removed after rows exist, and
 * a ragged grid would render as a table with cells missing from the middle.
 */
export function normalizeGrid(grid: SpecGrid | null | undefined): SpecGrid {
  const cols = Array.isArray(grid?.cols) ? grid.cols.map((c) => String(c ?? "")) : [];
  const rawRows = Array.isArray(grid?.rows) ? grid.rows : [];
  const rows = rawRows.map((row) => {
    const cells = Array.isArray(row) ? row.map((c) => String(c ?? "")) : [];
    if (cells.length === cols.length) return cells;
    return Array.from({ length: cols.length }, (_, i) => cells[i] ?? "");
  });
  return { cols, rows };
}

/** A row counts as filled if any cell has content — blank rows don't get saved. */
export function isFilledRow(row: string[]): boolean {
  return row.some((c) => c.trim().length > 0);
}

/** Drop trailing blank rows so an abandoned "+ Row" doesn't persist. */
export function trimGrid(grid: SpecGrid): SpecGrid {
  return { cols: grid.cols, rows: grid.rows.filter(isFilledRow) };
}

/** How many specified lines a type carries — the completeness figure. */
export function specRowCount(tables: SpecTable[]): number {
  return tables.reduce((n, t) => n + t.grid.rows.filter(isFilledRow).length, 0);
}

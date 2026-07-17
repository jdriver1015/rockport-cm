/**
 * Pure helpers for importing a chart of accounts from a spreadsheet. No DB or
 * server-only deps, so both the parse server action and the client preview
 * (which re-derives rows when the user corrects the column mapping) share them.
 */

export type ChartImportRow = {
  categoryCode: string;
  categoryName: string;
  code: string;
  name: string;
  isInterior: boolean;
};

export type ColumnRole = "categoryCode" | "categoryName" | "code" | "name" | "interior";

/** Detected/selected column index per role, -1 = not mapped. */
export type ChartColumnMapping = Record<ColumnRole, number>;

export const COLUMN_ROLES: { key: ColumnRole; label: string; required?: boolean }[] = [
  { key: "code", label: "Cost code", required: true },
  { key: "name", label: "Description" },
  { key: "categoryCode", label: "Category code" },
  { key: "categoryName", label: "Category name" },
  { key: "interior", label: "Interior?" },
];

const HEADER_HINTS: Record<ColumnRole, string[]> = {
  categoryCode: ["category code", "category", "cat code", "group code", "account group"],
  categoryName: ["category name", "category description", "group name", "group"],
  code: ["cost code", "code", "account", "gl code", "account code", "account number"],
  name: ["description", "name", "cost code name", "account name", "line item"],
  interior: ["interior", "is interior", "unit", "4000"],
};

export function normHeader(s: unknown): string {
  return String(s ?? "").trim().toLowerCase();
}

export function detectMapping(headers: string[]): ChartColumnMapping {
  const find = (hints: string[]) => {
    for (const [i, h] of headers.entries()) {
      if (hints.includes(normHeader(h))) return i;
    }
    for (const [i, h] of headers.entries()) {
      const nh = normHeader(h);
      if (hints.some((hint) => nh.includes(hint))) return i;
    }
    return -1;
  };
  return {
    categoryCode: find(HEADER_HINTS.categoryCode),
    categoryName: find(HEADER_HINTS.categoryName),
    code: find(HEADER_HINTS.code),
    name: find(HEADER_HINTS.name),
    interior: find(HEADER_HINTS.interior),
  };
}

const TRUTHY = new Set(["y", "yes", "true", "1", "x", "interior"]);

/**
 * Turn a grid body + column mapping into chart rows. When no category column is
 * mapped, a bare 4-digit row is treated as a category definition and the cost
 * code's 4-digit prefix supplies the category for hyphenated codes.
 */
export function rowsFromGrid(grid: string[][], mapping: ChartColumnMapping): ChartImportRow[] {
  const out: ChartImportRow[] = [];
  const catNameByCode = new Map<string, string>();

  for (const row of grid) {
    const cell = (i: number) => (i >= 0 ? String(row[i] ?? "").trim() : "");
    const code = cell(mapping.code);
    if (!code) continue;

    const prefix = code.slice(0, 4);
    const isCategoryRow = !code.includes("-") && /^\d{4}$/.test(code);

    let categoryCode = cell(mapping.categoryCode) || prefix;
    let categoryName = cell(mapping.categoryName);

    if (isCategoryRow && mapping.categoryCode < 0) {
      catNameByCode.set(code, cell(mapping.name) || categoryName || code);
      continue;
    }
    if (!categoryCode) categoryCode = prefix;
    if (!categoryName) categoryName = catNameByCode.get(categoryCode) ?? categoryCode;

    const interiorRaw = normHeader(cell(mapping.interior));
    const isInterior = mapping.interior >= 0 ? TRUTHY.has(interiorRaw) : prefix === "4000";

    out.push({
      categoryCode,
      categoryName,
      code,
      name: cell(mapping.name) || code,
      isInterior,
    });
  }
  return out;
}

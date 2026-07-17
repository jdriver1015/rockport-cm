"use server";

import { revalidatePath } from "next/cache";
import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import * as XLSX from "xlsx";
import { db, schema } from "@/db";
import type { ActionResult } from "@/lib/action-result";
import {
  type ChartColumnMapping,
  type ChartImportRow,
  detectMapping,
  rowsFromGrid,
} from "@/lib/chart-import";

export type { ChartImportRow } from "@/lib/chart-import";

// ---------------------------------------------------------------------------
// Charts of accounts — a portfolio can hold several. Each is a self-contained
// set of categories + cost codes + mapping rules. Properties bind to one.
// ---------------------------------------------------------------------------

function revalidateCharts(chartId?: number) {
  revalidatePath("/settings/chart-of-accounts");
  if (chartId != null) revalidatePath(`/settings/chart-of-accounts/${chartId}`);
}

const createChartSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  description: z.string().trim().optional(),
});

/**
 * Materialize categories + cost codes for a chart from a flat row list.
 * Categories are de-duplicated by code (first name wins); each code hangs off
 * its category. Runs inside the caller's transaction handle.
 */
async function insertChartRows(
  tx: Awaited<ReturnType<typeof db>>,
  chartId: number,
  rows: ChartImportRow[],
) {
  // Distinct categories in first-seen order.
  const catByCode = new Map<string, string>();
  const catOrder: string[] = [];
  for (const r of rows) {
    if (!catByCode.has(r.categoryCode)) {
      catByCode.set(r.categoryCode, r.categoryName || r.categoryCode);
      catOrder.push(r.categoryCode);
    }
  }
  if (catOrder.length === 0) return { categories: 0, codes: 0 };

  const insertedCats = await tx
    .insert(schema.costCategories)
    .values(
      catOrder.map((code, i) => ({
        chartId,
        code,
        name: catByCode.get(code) ?? code,
        sortOrder: i,
      })),
    )
    .returning({ id: schema.costCategories.id, code: schema.costCategories.code });
  const catIdByCode = new Map(insertedCats.map((c) => [c.code, c.id]));

  // Codes, de-duplicated by code (chart-unique).
  const seenCodes = new Set<string>();
  const codeValues: (typeof schema.costCodes.$inferInsert)[] = [];
  for (const r of rows) {
    if (seenCodes.has(r.code)) continue;
    const categoryId = catIdByCode.get(r.categoryCode);
    if (!categoryId) continue;
    seenCodes.add(r.code);
    codeValues.push({
      chartId,
      categoryId,
      code: r.code,
      name: r.name || r.code,
      isInterior: r.isInterior,
    });
  }
  if (codeValues.length > 0) {
    await tx.insert(schema.costCodes).values(codeValues);
  }
  return { categories: catOrder.length, codes: codeValues.length };
}

/** Create an empty chart. */
export async function createChart(input: {
  name: string;
  description?: string;
}): Promise<ActionResult<{ chartId: number }>> {
  const parsed = createChartSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const [chart] = await db()
    .insert(schema.chartsOfAccounts)
    .values({ name: parsed.data.name, description: parsed.data.description })
    .returning({ id: schema.chartsOfAccounts.id });
  revalidateCharts();
  return { ok: true, chartId: chart.id };
}

/** Create a chart by deep-copying an existing chart's categories, codes, and rules. */
export async function cloneChart(input: {
  sourceChartId: number;
  name: string;
  description?: string;
}): Promise<ActionResult<{ chartId: number }>> {
  const parsed = createChartSchema.safeParse({ name: input.name, description: input.description });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const source = await db().query.chartsOfAccounts.findFirst({
    where: eq(schema.chartsOfAccounts.id, input.sourceChartId),
  });
  if (!source) return { ok: false, error: "Source chart not found" };

  const [chart] = await db()
    .insert(schema.chartsOfAccounts)
    .values({ name: parsed.data.name, description: parsed.data.description })
    .returning({ id: schema.chartsOfAccounts.id });
  const chartId = chart.id;

  const cats = await db()
    .select()
    .from(schema.costCategories)
    .where(eq(schema.costCategories.chartId, input.sourceChartId))
    .orderBy(asc(schema.costCategories.sortOrder), asc(schema.costCategories.code));

  const catIdMap = new Map<number, number>();
  if (cats.length > 0) {
    const newCats = await db()
      .insert(schema.costCategories)
      .values(
        cats.map((c) => ({
          chartId,
          code: c.code,
          name: c.name,
          sortOrder: c.sortOrder,
          division: c.division,
        })),
      )
      .returning({ id: schema.costCategories.id, code: schema.costCategories.code });
    const newCatByCode = new Map(newCats.map((c) => [c.code, c.id]));
    for (const c of cats) {
      const newId = newCatByCode.get(c.code);
      if (newId) catIdMap.set(c.id, newId);
    }
  }

  const codes = await db()
    .select()
    .from(schema.costCodes)
    .where(eq(schema.costCodes.chartId, input.sourceChartId));

  const codeIdMap = new Map<number, number>();
  if (codes.length > 0) {
    const newCodes = await db()
      .insert(schema.costCodes)
      .values(
        codes.map((c) => ({
          chartId,
          categoryId: catIdMap.get(c.categoryId) ?? c.categoryId,
          code: c.code,
          name: c.name,
          isInterior: c.isInterior,
          active: c.active,
        })),
      )
      .returning({ id: schema.costCodes.id, code: schema.costCodes.code });
    const newCodeByCode = new Map(newCodes.map((c) => [c.code, c.id]));
    for (const c of codes) {
      const newId = newCodeByCode.get(c.code);
      if (newId) codeIdMap.set(c.id, newId);
    }
  }

  const rules = await db()
    .select()
    .from(schema.mappingRules)
    .where(eq(schema.mappingRules.chartId, input.sourceChartId));
  if (rules.length > 0) {
    const remapped = rules
      .map((r) => {
        const costCodeId = codeIdMap.get(r.costCodeId);
        if (!costCodeId) return null;
        return {
          chartId,
          matchType: r.matchType,
          pattern: r.pattern,
          costCodeId,
          priority: r.priority,
          active: r.active,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
    if (remapped.length > 0) await db().insert(schema.mappingRules).values(remapped);
  }

  revalidateCharts();
  return { ok: true, chartId };
}

/** Create a chart from parsed spreadsheet rows (upload path). */
export async function createChartFromRows(input: {
  name: string;
  description?: string;
  rows: ChartImportRow[];
}): Promise<ActionResult<{ chartId: number; categories: number; codes: number }>> {
  const parsed = createChartSchema.safeParse({ name: input.name, description: input.description });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  if (!input.rows?.length) return { ok: false, error: "No rows to import" };

  const [chart] = await db()
    .insert(schema.chartsOfAccounts)
    .values({ name: parsed.data.name, description: parsed.data.description })
    .returning({ id: schema.chartsOfAccounts.id });

  const { categories, codes } = await insertChartRows(db(), chart.id, input.rows);
  revalidateCharts();
  return { ok: true, chartId: chart.id, categories, codes };
}

export async function updateChart(input: {
  id: number;
  name: string;
  description?: string;
}): Promise<ActionResult> {
  const parsed = createChartSchema.safeParse({ name: input.name, description: input.description });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  await db()
    .update(schema.chartsOfAccounts)
    .set({ name: parsed.data.name, description: parsed.data.description ?? null })
    .where(eq(schema.chartsOfAccounts.id, input.id));
  revalidateCharts(input.id);
  return { ok: true };
}

/** Make this chart the portfolio default (clears the flag on the previous default). */
export async function setDefaultChart(id: number): Promise<ActionResult> {
  await db().transaction(async (tx) => {
    await tx
      .update(schema.chartsOfAccounts)
      .set({ isDefault: false })
      .where(eq(schema.chartsOfAccounts.isDefault, true));
    await tx
      .update(schema.chartsOfAccounts)
      .set({ isDefault: true })
      .where(eq(schema.chartsOfAccounts.id, id));
  });
  revalidateCharts(id);
  return { ok: true };
}

/**
 * Archive a chart. Blocked if any property is still bound to it — reassign or
 * delete those first, so no property is left pointing at a hidden chart.
 */
export async function archiveChart(id: number): Promise<ActionResult> {
  const chart = await db().query.chartsOfAccounts.findFirst({
    where: eq(schema.chartsOfAccounts.id, id),
  });
  if (!chart) return { ok: false, error: "Chart not found" };
  if (chart.isDefault) return { ok: false, error: "Can't archive the default chart — set another as default first" };

  const [{ count }] = await db()
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.properties)
    .where(eq(schema.properties.chartOfAccountsId, id));
  if (count > 0) {
    return {
      ok: false,
      error: `${count} propert${count === 1 ? "y is" : "ies are"} still using this chart`,
    };
  }

  await db()
    .update(schema.chartsOfAccounts)
    .set({ archivedAt: new Date() })
    .where(eq(schema.chartsOfAccounts.id, id));
  revalidateCharts();
  return { ok: true };
}

export async function restoreChart(id: number): Promise<ActionResult> {
  await db()
    .update(schema.chartsOfAccounts)
    .set({ archivedAt: null })
    .where(eq(schema.chartsOfAccounts.id, id));
  revalidateCharts();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Spreadsheet import — parse an uploaded chart file into ChartImportRows for a
// preview/confirm step. Auto-detects columns by header keywords; the client can
// override the mapping before committing via createChartFromRows.
// ---------------------------------------------------------------------------

export type ChartParsePreview = {
  headers: string[];
  mapping: ChartColumnMapping;
  /** Full grid body (header stripped) so the client can re-derive rows on remap. */
  body: string[][];
  rows: ChartImportRow[];
};

export async function parseChartWorkbook(formData: FormData): Promise<ActionResult<ChartParsePreview>> {
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No file uploaded" };
  if (!/\.(xlsx|xlsm|xls|csv)$/i.test(file.name)) {
    return { ok: false, error: "Unsupported file type — upload .xlsx, .xls, or .csv" };
  }

  const buf = await file.arrayBuffer();
  let grid: string[][];
  try {
    const wb = XLSX.read(buf, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) return { ok: false, error: "The file has no sheets" };
    const raw: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
    grid = raw.map((r) => r.map((c) => String(c ?? "").trim()));
  } catch {
    return { ok: false, error: "Could not read the spreadsheet" };
  }

  // First non-empty row is the header.
  const headerRow = grid.findIndex((r) => r.some((c) => c !== ""));
  if (headerRow < 0) return { ok: false, error: "The file appears to be empty" };
  const headers = grid[headerRow];
  const mapping = detectMapping(headers);

  const body = grid.slice(headerRow + 1).filter((r) => r.some((c) => c !== ""));
  const rows = rowsFromGrid(body, mapping);
  return { ok: true, headers, mapping, body, rows };
}

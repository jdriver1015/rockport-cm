"use server";

import { revalidatePath } from "next/cache";
import * as XLSX from "xlsx";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import {
  detectBudgetMapping,
  findBudgetHeaderRow,
  budgetRowsFromGrid,
  type BudgetImportRow,
  type BudgetColumnMapping,
} from "@/lib/budget-import";
import {
  previewBudgetImportForProperty,
  previewBudgetImportForChart,
  applyBudgetImport,
  type BudgetImportPreview,
  type MatchedLine,
  type ArchiveLine,
} from "@/lib/property-budget-import";
import { propertyPath } from "@/lib/property-path";
import { assertBudgetUnlockedForUpdate } from "@/lib/property-budget-lock";
import type { ActionResult } from "@/lib/action-result";

export type BudgetWorkbookParse = {
  headers: string[];
  mapping: BudgetColumnMapping;
  rows: BudgetImportRow[];
};

/**
 * File → grid → rows. Shared by both entry points: the file itself does not
 * know or care whether it is about to become a brand-new property's budget or
 * replace an existing one, so parsing asks nothing about that.
 */
export async function parseBudgetWorkbook(formData: FormData): Promise<ActionResult<BudgetWorkbookParse>> {
  const auth = await requireUser();
  if (!auth.ok) return auth;

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

  const headerRow = findBudgetHeaderRow(grid);
  if (headerRow < 0) {
    return {
      ok: false,
      error: "Could not find a header row with both an item/description column and an amount column",
    };
  }
  const headers = grid[headerRow];
  const mapping = detectBudgetMapping(headers);

  const body = grid.slice(headerRow + 1).filter((r) => r.some((c) => c !== ""));
  const rows = budgetRowsFromGrid(body, mapping);
  if (rows.length === 0) {
    return { ok: false, error: "No budget lines found under the detected header row" };
  }

  return { ok: true, headers, mapping, rows };
}

/** Preview for an existing property — the Budget tab's "Upload / Replace" action. */
export async function previewBudgetImport(
  propertyId: number,
  rows: BudgetImportRow[],
): Promise<ActionResult<BudgetImportPreview>> {
  const auth = await requireUser();
  if (!auth.ok) return auth;

  const property = await db().query.properties.findFirst({ where: eq(schema.properties.id, propertyId) });
  if (!property) return { ok: false, error: "Property not found" };

  const preview = await previewBudgetImportForProperty(propertyId, property.chartOfAccountsId, rows);
  return { ok: true, ...preview };
}

/** Preview for a chart with no property yet — shown during property creation. */
export async function previewBudgetImportForNewProperty(
  chartOfAccountsId: number,
  rows: BudgetImportRow[],
): Promise<ActionResult<BudgetImportPreview>> {
  const auth = await requireUser();
  if (!auth.ok) return auth;

  const chart = await db().query.chartsOfAccounts.findFirst({ where: eq(schema.chartsOfAccounts.id, chartOfAccountsId) });
  if (!chart) return { ok: false, error: "Selected chart of accounts no longer exists" };

  const preview = await previewBudgetImportForChart(chartOfAccountsId, rows);
  return { ok: true, ...preview };
}

/**
 * Replaces an existing property's non-interior budget with a reviewed
 * preview's decisions.
 *
 * One transaction: this is a single action from the person's point of view —
 * "load this workbook" — and should not be able to half-apply if something
 * fails partway through the matched lines.
 */
export async function applyBudgetOverwrite(
  propertyId: number,
  matched: MatchedLine[],
  toArchive: ArchiveLine[],
): Promise<ActionResult> {
  const auth = await requireUser();
  if (!auth.ok) return auth;

  const property = await db().query.properties.findFirst({ where: eq(schema.properties.id, propertyId) });
  if (!property) return { ok: false, error: "Property not found" };

  // Every matched code has to still belong to this property's chart — the
  // preview could be stale if the chart changed underneath it between preview
  // and confirm, which a re-check here is cheap enough to always do.
  if (matched.length > 0) {
    const ids = matched.map((m) => m.costCodeId);
    const valid = await db()
      .select({ id: schema.costCodes.id })
      .from(schema.costCodes)
      .where(and(eq(schema.costCodes.chartId, property.chartOfAccountsId), eq(schema.costCodes.active, true)));
    const validIds = new Set(valid.map((v) => v.id));
    if (!ids.every((id) => validIds.has(id))) {
      return { ok: false, error: "This preview is stale — the chart of accounts changed. Re-upload the file." };
    }
  }

  // The lock check runs inside the same transaction as the write, via a row
  // lock on the property — not a plain read beforehand, which would leave a
  // gap for a concurrent lockBudget to land in unnoticed.
  const result = await db().transaction(async (tx): Promise<ActionResult> => {
    const lockCheck = await assertBudgetUnlockedForUpdate(tx, propertyId);
    if (!lockCheck.ok) return lockCheck;

    await applyBudgetImport(tx, propertyId, matched, toArchive);
    return { ok: true };
  });
  if (!result.ok) return result;

  const path = await propertyPath(propertyId, "/budget");
  if (path) revalidatePath(path);
  revalidatePath("/");
  return { ok: true };
}

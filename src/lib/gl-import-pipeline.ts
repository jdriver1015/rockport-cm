import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { ATTACHMENTS_BUCKET, createAdminClient } from "@/lib/supabase/admin";
import {
  autoMapRow,
  dedupeKey,
  extractSheetPreview,
  fingerprintHeaders,
  parseGlWorkbook,
  type ColumnOverride,
  type GlParseResult,
  type MapContext,
  type MappingRule,
  type ParsedGlRow,
} from "@/lib/gl-import";

/**
 * One account-section summary staged on `import_batches.accountSummary` while a
 * batch awaits account selection.
 */
export type AccountSummary = {
  code: string;
  name: string | null;
  rowCount: number;
  total: number;
  /** Heuristic pre-check for the selection UI */
  suggested: boolean;
  /** Whether a per-property decision already existed in memory */
  remembered: boolean;
};

/** Build the auto-mapping context (rules, cost codes, units, projects, dedupe keys). */
export async function buildMapContext(propertyId: number): Promise<MapContext> {
  // Rules and codes are scoped to the property's chart of accounts.
  const property = await db().query.properties.findFirst({
    where: eq(schema.properties.id, propertyId),
    columns: { chartOfAccountsId: true },
  });
  if (!property) throw new Error(`Property ${propertyId} not found`);
  const chartId = property.chartOfAccountsId;

  const rules: MappingRule[] = (
    await db()
      .select({
        matchType: schema.mappingRules.matchType,
        pattern: schema.mappingRules.pattern,
        costCodeId: schema.mappingRules.costCodeId,
        priority: schema.mappingRules.priority,
      })
      .from(schema.mappingRules)
      .where(and(eq(schema.mappingRules.chartId, chartId), eq(schema.mappingRules.active, true)))
  )
    .map((r) => ({ ...r, matchType: r.matchType as MappingRule["matchType"] }))
    .sort((a, b) => a.priority - b.priority);

  const codes = await db()
    .select({ id: schema.costCodes.id, isInterior: schema.costCodes.isInterior })
    .from(schema.costCodes)
    .where(eq(schema.costCodes.chartId, chartId));
  const interiorByCode = new Map(codes.map((c) => [c.id, c.isInterior]));

  const units = await db()
    .select({ id: schema.units.id, unitNumber: schema.units.unitNumber })
    .from(schema.units)
    .where(eq(schema.units.propertyId, propertyId));
  const unitIdByNumber = new Map(units.map((u) => [u.unitNumber.toUpperCase(), u.id]));

  const projects = await db()
    .select({
      id: schema.projects.id,
      kind: schema.projects.kind,
      costCodeId: schema.projects.costCodeId,
      unitId: schema.projects.unitId,
    })
    .from(schema.projects)
    .where(eq(schema.projects.propertyId, propertyId));

  const unitProjectByUnitId = new Map<number, number>();
  const commonProjectsByCode = new Map<number, number[]>();
  for (const p of projects) {
    if (p.kind === "unit" && p.unitId != null) unitProjectByUnitId.set(p.unitId, p.id);
    if (p.kind === "common" && p.costCodeId != null) {
      const arr = commonProjectsByCode.get(p.costCodeId) ?? [];
      arr.push(p.id);
      commonProjectsByCode.set(p.costCodeId, arr);
    }
  }

  const postedRows = await db()
    .select({
      vendorRaw: schema.glTransactions.vendorRaw,
      amount: schema.glTransactions.amount,
      invoiceNo: schema.glTransactions.invoiceNo,
    })
    .from(schema.glTransactions)
    .where(
      and(
        eq(schema.glTransactions.propertyId, propertyId),
        eq(schema.glTransactions.status, "posted"),
      ),
    );
  const postedKeys = new Set(
    postedRows.map((r) => dedupeKey(r.vendorRaw, parseFloat(r.amount), r.invoiceNo)),
  );

  return {
    rules,
    interiorByCode,
    unitIdByNumber,
    unitProjectByUnitId,
    commonProjectsByCode,
    postedKeys,
  };
}

/**
 * Auto-map the given parsed rows against the property's context and insert them
 * as staged `gl_transactions` on the batch. Duplicates (vs posted rows or
 * earlier rows in the same set) start excluded so they don't double-count.
 */
export async function insertMappedTransactions(
  propertyId: number,
  batchId: number,
  rows: ParsedGlRow[],
): Promise<{ rowCount: number; autoMappedCount: number; needsReviewCount: number; duplicates: number }> {
  const ctx = await buildMapContext(propertyId);
  const mapped = rows.map((r) => {
    const m = autoMapRow(r, ctx);
    ctx.postedKeys.add(dedupeKey(r.vendorRaw, r.amount, r.invoiceNo));
    return m;
  });

  const autoMappedCount = mapped.filter((m) => m.status === "staged").length;
  const needsReviewCount = mapped.filter((m) => m.status === "needs_review").length;
  const duplicates = mapped.filter((m) => m.isDuplicate).length;

  const values = mapped.map((m) => ({
    propertyId,
    batchId,
    costCodeId: m.costCodeId,
    projectId: m.projectId,
    vendorRaw: m.vendorRaw,
    description: m.description,
    amount: m.amount.toFixed(2),
    txnDate: m.txnDate,
    invoiceNo: m.invoiceNo,
    checkNo: m.checkNo,
    drawNo: m.drawNo,
    unitLabel: m.unitLabel,
    glAccountRaw: m.glAccountRaw,
    status: m.status,
    sourceRow: m.sourceRow,
    ...(m.isDuplicate
      ? { status: "excluded" as const, excludeReason: "Possible duplicate" }
      : {}),
  }));

  // Chunk the insert: each row binds ~16 params and Postgres caps a statement at
  // 65535, so a single .values() over a few thousand rows would throw.
  const CHUNK = 500;
  for (let i = 0; i < values.length; i += CHUNK) {
    await db().insert(schema.glTransactions).values(values.slice(i, i + CHUNK));
  }

  return { rowCount: mapped.length, autoMappedCount, needsReviewCount, duplicates };
}

/** Re-download a batch's archived file from storage. */
export async function downloadStoredFile(storagePath: string): Promise<ArrayBuffer> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(ATTACHMENTS_BUCKET).download(storagePath);
  if (error || !data) {
    throw new Error(`Could not read stored file: ${error?.message ?? "not found"}`);
  }
  return data.arrayBuffer();
}

/** Re-download a batch's archived file and re-parse it (optionally with a saved mapping). */
export async function reparseStoredBatch(
  storagePath: string,
  override?: ColumnOverride,
): Promise<GlParseResult> {
  return parseGlWorkbook(await downloadStoredFile(storagePath), override);
}

/**
 * When header auto-detection fails, look for a previously-saved column mapping
 * whose header fingerprint matches one of the file's candidate rows. Returns a
 * ready-to-use override (with its sheet) or null.
 */
export async function lookupFormatMemory(buf: ArrayBuffer): Promise<ColumnOverride | null> {
  const preview = extractSheetPreview(buf, 25);
  const candidates: { fp: string; sheetName: string }[] = [];
  for (const sheet of preview.sheets) {
    for (const row of sheet.rows) {
      const labels = row.map((c) => c.trim().toLowerCase()).filter(Boolean);
      if (labels.length >= 3) candidates.push({ fp: fingerprintHeaders(labels), sheetName: sheet.name });
    }
  }
  if (candidates.length === 0) return null;

  const fps = [...new Set(candidates.map((c) => c.fp))];
  const hits = await db()
    .select({
      fingerprint: schema.glImportFormats.fingerprint,
      columnMapping: schema.glImportFormats.columnMapping,
    })
    .from(schema.glImportFormats)
    .where(inArray(schema.glImportFormats.fingerprint, fps));
  if (hits.length === 0) return null;

  const byFp = new Map(hits.map((h) => [h.fingerprint, h.columnMapping as ColumnOverride]));
  for (const c of candidates) {
    const mapping = byFp.get(c.fp);
    if (mapping) return { ...mapping, sheetName: c.sheetName };
  }
  return null;
}

/** Remember a confirmed manual column mapping keyed by its header fingerprint. */
export async function saveFormatMemory(
  headerLabels: string[],
  mapping: ColumnOverride,
  sourceSystem: string | null,
  userId: string | null,
): Promise<void> {
  const fingerprint = fingerprintHeaders(headerLabels);
  const now = new Date();
  await db()
    .insert(schema.glImportFormats)
    .values({ fingerprint, columnMapping: mapping, sourceSystem, createdBy: userId, updatedAt: now })
    .onConflictDoUpdate({
      target: schema.glImportFormats.fingerprint,
      set: { columnMapping: mapping, sourceSystem, updatedAt: now },
    });
}

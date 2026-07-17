/**
 * DB glue for the rent-roll importer: loading mapping memory, materializing
 * parsed units into rent_roll_units, persisting learned formats + column
 * examples, and re-downloading a stored file for re-parse. Mirrors the GL
 * pipeline's split between pure parsing (rent-roll-import.ts) and DB writes.
 */
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { ATTACHMENTS_BUCKET, createAdminClient } from "@/lib/supabase/admin";
import type { AiMapping, ParsedUnit, RowFlag } from "@/lib/rent-roll-mapping";

const UNIT_CHUNK = 500;

/** Fingerprint → saved mapping JSON, newest first (a hit skips all AI). */
export async function loadFormatMemory(): Promise<Map<string, string>> {
  const rows = await db()
    .select({
      fingerprint: schema.rentRollFormats.fingerprint,
      columnMapping: schema.rentRollFormats.columnMapping,
    })
    .from(schema.rentRollFormats)
    .orderBy(desc(schema.rentRollFormats.updatedAt))
    .limit(200);
  const map = new Map<string, string>();
  for (const r of rows) {
    if (!map.has(r.fingerprint)) map.set(r.fingerprint, JSON.stringify(r.columnMapping));
  }
  return map;
}

/** Past confirmed header-label → field mappings, deduped newest-first. */
export async function loadPastExamples(): Promise<Array<{ raw_label: string; mapped_to: string }>> {
  const rows = await db()
    .select({
      rawLabel: schema.rentRollMappingExamples.rawLabel,
      mappedTo: schema.rentRollMappingExamples.mappedTo,
    })
    .from(schema.rentRollMappingExamples)
    .orderBy(desc(schema.rentRollMappingExamples.updatedAt))
    .limit(80);
  const seen = new Set<string>();
  const out: Array<{ raw_label: string; mapped_to: string }> = [];
  for (const r of rows) {
    const key = r.rawLabel.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ raw_label: r.rawLabel, mapped_to: r.mappedTo });
  }
  return out;
}

const numStr = (n: number | null | undefined): string | null =>
  n == null ? null : String(n);

/** Replace a batch's parsed unit rows with a fresh set. Flags mark rows the
 *  parser guessed at so the review sheet surfaces them. */
export async function replaceUnits(
  propertyId: number,
  batchId: number,
  units: ParsedUnit[],
  rowFlags: RowFlag[],
): Promise<void> {
  await db().delete(schema.rentRollUnits).where(eq(schema.rentRollUnits.batchId, batchId));
  if (units.length === 0) return;

  const flagByUnit = new Map<string, string>();
  for (const f of rowFlags) {
    if (!flagByUnit.has(f.unit_number)) flagByUnit.set(f.unit_number, f.detail);
  }

  const values = units.map((u, i) => {
    const note = flagByUnit.get(u.unit_number) ?? null;
    return {
      propertyId,
      batchId,
      unitNumber: u.unit_number,
      floorPlanCode: u.floor_plan_code,
      beds: u.beds,
      baths: numStr(u.baths),
      squareFeet: u.square_feet,
      marketRent: numStr(u.market_rent),
      inPlaceRent: numStr(u.in_place_rent),
      leaseStart: u.lease_start,
      leaseEnd: u.lease_end,
      status: u.status,
      residentName: u.resident_name,
      needsReview: note != null,
      reviewNote: note,
      sourceRow: i,
    };
  });

  for (let i = 0; i < values.length; i += UNIT_CHUNK) {
    await db().insert(schema.rentRollUnits).values(values.slice(i, i + UNIT_CHUNK));
  }
}

/** Remember a confirmed format keyed by its header fingerprint (upsert). */
export async function saveFormatMemory(
  fingerprint: string,
  mapping: AiMapping,
  sourceSystem: string | null,
  createdBy: string | null,
): Promise<void> {
  const now = new Date();
  await db()
    .insert(schema.rentRollFormats)
    .values({ fingerprint, columnMapping: mapping, sourceSystem, createdBy })
    .onConflictDoUpdate({
      target: schema.rentRollFormats.fingerprint,
      set: {
        columnMapping: mapping,
        sourceSystem,
        updatedAt: now,
      },
    });
}

const EXAMPLE_FIELDS: Array<keyof AiMapping["columns"]> = [
  "unit_number",
  "floor_plan_code",
  "beds",
  "baths",
  "square_feet",
  "market_rent",
  "in_place_rent",
  "status",
  "resident_name",
  "lease_start",
  "lease_end",
];

/** Train the AI mapper: store each mapped header label → field, so future
 *  files with similar labels map deterministically as a strong hint. */
export async function saveMappingExamples(
  headerLabels: string[],
  mapping: AiMapping,
  createdBy: string | null,
): Promise<void> {
  const rows: { rawLabel: string; mappedTo: string; createdBy: string | null }[] = [];
  for (const field of EXAMPLE_FIELDS) {
    const col = mapping.columns[field];
    if (col == null) continue;
    const label = (headerLabels[col] ?? "").trim();
    if (!label) continue;
    rows.push({ rawLabel: label, mappedTo: field, createdBy });
  }
  if (rows.length === 0) return;
  const now = new Date();
  await db()
    .insert(schema.rentRollMappingExamples)
    .values(rows)
    .onConflictDoUpdate({
      target: [schema.rentRollMappingExamples.rawLabel, schema.rentRollMappingExamples.mappedTo],
      set: { updatedAt: now },
    });
}

/** Re-download an archived rent-roll file for re-parse. */
export async function downloadStoredFile(storagePath: string): Promise<ArrayBuffer> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(ATTACHMENTS_BUCKET).download(storagePath);
  if (error || !data) {
    throw new Error(`Could not read the stored file: ${error?.message ?? "unknown"}`);
  }
  return data.arrayBuffer();
}

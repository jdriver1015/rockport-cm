/**
 * Lexington at Champions import, step 4 of 4: stages the real 162-row GL
 * ledger through the app's actual intake pipeline (same parse/auto-map/insert
 * functions the upload UI calls — see src/lib/gl-import.ts and
 * src/lib/gl-import-pipeline.ts), then bulk-posts everything that resolved a
 * cost code. Anything left in needs_review (e.g. the one row with a blank
 * legacy code) stays for manual review in the existing GL screen.
 *
 * Run after seed-lexington-coa-budget.ts (mapping rules), seed-lexington-units.ts
 * (unit projects, so rows attribute to the right unit turn), and
 * seed-lexington-schedule.ts (common projects, for the cost codes with a
 * unique common project).
 * Run: npx tsx scripts/import-lexington-gl.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq, sql } from "drizzle-orm";
import postgres from "postgres";
import { parseGlWorkbook } from "../src/lib/gl-import";
import { insertMappedTransactions } from "../src/lib/gl-import-pipeline";
import { glTransactions, importBatches, properties } from "../src/db/schema";
import { GL_COLUMNS, PROPERTY_ID, readWorkbookBuffer } from "./lexington-workbook";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (.env.local)");
  const client = postgres(url, { prepare: false, ssl: "require" });
  const db = drizzle(client);

  const existing = await db
    .select({ id: importBatches.id })
    .from(importBatches)
    .where(eq(importBatches.propertyId, PROPERTY_ID));
  if (existing.length > 0) {
    throw new Error(`Property ${PROPERTY_ID} already has an import batch — aborting to avoid duplicates.`);
  }

  const buf = readWorkbookBuffer();
  const parsed = parseGlWorkbook(buf, GL_COLUMNS);
  if (parsed.rows.length === 0) throw new Error("Parsed 0 GL rows — check GL_COLUMNS in lexington-workbook.ts");

  const [batch] = await db
    .insert(importBatches)
    .values({
      propertyId: PROPERTY_ID,
      fileName: "Lexington at Champions - Construction Tracker.xlsx",
      sourceSystem: "Legacy construction tracker",
      status: "in_review",
      rowCount: parsed.rows.length,
      periodDate: parsed.periodDate,
    })
    .returning({ id: importBatches.id });

  const counts = await insertMappedTransactions(PROPERTY_ID, batch.id, parsed.rows);
  await db
    .update(importBatches)
    .set({ autoMappedCount: counts.autoMappedCount, needsReviewCount: counts.needsReviewCount })
    .where(eq(importBatches.id, batch.id));

  // Bulk-post everything that resolved a cost code (mirrors postAllReady in
  // src/lib/actions/gl.ts, minus its revalidatePath call which needs a real
  // Next.js request).
  const posted = await db
    .update(glTransactions)
    .set({ status: "posted", postedAt: new Date() })
    .where(
      and(
        eq(glTransactions.propertyId, PROPERTY_ID),
        eq(glTransactions.status, "staged"),
        sql`${glTransactions.costCodeId} is not null`,
      ),
    )
    .returning({ id: glTransactions.id, amount: glTransactions.amount });

  const [{ maxDate }] = await db
    .select({ maxDate: sql<string | null>`max(${glTransactions.txnDate})` })
    .from(glTransactions)
    .where(and(eq(glTransactions.propertyId, PROPERTY_ID), eq(glTransactions.status, "posted")));
  await db.update(properties).set({ glUpdatedThru: maxDate }).where(eq(properties.id, PROPERTY_ID));

  await db.update(importBatches).set({ status: "posted" }).where(eq(importBatches.id, batch.id));

  const postedTotal = posted.reduce((s, r) => s + parseFloat(r.amount), 0);

  await client.end();
  console.log(`Batch ${batch.id}: ${parsed.rows.length} rows parsed (skipped ${parsed.skipped}).`);
  console.log(`  ${counts.autoMappedCount} auto-mapped, ${counts.needsReviewCount} need review, ${counts.duplicates} duplicates excluded.`);
  console.log(`Posted ${posted.length} transactions, total $${postedTotal.toLocaleString()}.`);
  console.log(`glUpdatedThru set to ${maxDate}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

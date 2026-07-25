/**
 * One-time backfill: recovers `scope_items.category` for scope lines created
 * before the column existed.
 *
 * `createInteriorProject` accepted a `category` on each line and silently
 * dropped it (the insert never wrote it), so every wizard-created scope line
 * lost its trade section. The provenance column `sourceGroupItemId` still
 * points at the scope-group item it came from, so the category is recoverable
 * — best-effort, since that column has no FK, is nullable for manual lines,
 * and the source item may since have been edited or deleted.
 *
 * Also backfills `productLink`, dropped by the same insert, where the source
 * item still has one and the scope line doesn't.
 *
 * Run: npx tsx scripts/backfill-scope-categories.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import postgres from "postgres";
import { scopeGroupItems, scopeItems } from "../src/db/schema";

/**
 * Legacy line names → canonical trade sections (src/lib/scope-sections.ts).
 * The Lexington historical import named each scope line after its legacy cost
 * code, so the line name already *is* the trade — it just needs normalizing.
 *
 * Two of these are judgment calls worth knowing about: "Fixtures" was HD Supply
 * supply kits, so it maps to Plumbing; "Backsplash" maps to Tile.
 */
const LEGACY_NAME_TO_SECTION: Record<string, string> = {
  "interior appliances - renovations": "Appliances",
  "interior backsplash - renovation": "Tile",
  "interior cabinets - renovation": "Cabinets",
  "interior carpet- renovation": "Flooring",
  "interior countertops - renovation": "Countertops",
  "interior fixtures - renovation": "Plumbing",
  "interior hard surface flooring - renovation": "Flooring",
  "interior labor - renovation": "General / Misc",
  "interior miscellaneous - renovation": "General / Misc",
  "interior paint - renovation": "Paint & Drywall",
  "lvp flooring": "Flooring",
  paint: "Paint & Drywall",
};

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (.env.local)");
  const client = postgres(url, { prepare: false, ssl: "require" });
  const db = drizzle(client);

  // Only lines that still have provenance and are missing a category.
  const candidates = await db
    .select({
      id: scopeItems.id,
      sourceGroupItemId: scopeItems.sourceGroupItemId,
      productLink: scopeItems.productLink,
      sourceCategory: scopeGroupItems.category,
      sourceProductLink: scopeGroupItems.productLink,
    })
    .from(scopeItems)
    .innerJoin(scopeGroupItems, eq(scopeItems.sourceGroupItemId, scopeGroupItems.id))
    .where(and(isNull(scopeItems.category), isNotNull(scopeItems.sourceGroupItemId)));

  let categoryUpdates = 0;
  let linkUpdates = 0;

  for (const row of candidates) {
    const patch: { category?: string; productLink?: string } = {};
    if (row.sourceCategory) {
      patch.category = row.sourceCategory;
      categoryUpdates++;
    }
    // Don't clobber a link someone set by hand on the scope line.
    if (!row.productLink && row.sourceProductLink) {
      patch.productLink = row.sourceProductLink;
      linkUpdates++;
    }
    if (Object.keys(patch).length === 0) continue;
    await db.update(scopeItems).set(patch).where(eq(scopeItems.id, row.id));
  }

  // Second pass: lines with no provenance at all (direct historical inserts),
  // where the line name itself names the trade.
  const nameless = await db
    .select({ id: scopeItems.id, item: scopeItems.item })
    .from(scopeItems)
    .where(and(isNull(scopeItems.category), isNull(scopeItems.archivedAt)));

  let fromName = 0;
  for (const row of nameless) {
    const section = LEGACY_NAME_TO_SECTION[row.item.trim().toLowerCase()];
    if (!section) continue;
    await db.update(scopeItems).set({ category: section }).where(eq(scopeItems.id, row.id));
    fromName++;
  }

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(scopeItems)
    .where(isNull(scopeItems.archivedAt));
  const [{ withCategory }] = await db
    .select({ withCategory: sql<number>`count(*)::int` })
    .from(scopeItems)
    .where(and(isNull(scopeItems.archivedAt), isNotNull(scopeItems.category)));

  await client.end();
  console.log(`Examined ${candidates.length} scope lines with recoverable provenance.`);
  console.log(`  ${categoryUpdates} categories recovered, ${linkUpdates} product links recovered.`);
  console.log(`Mapped ${fromName} more from legacy line names.`);
  console.log(`Active scope lines now categorized: ${withCategory} of ${total}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

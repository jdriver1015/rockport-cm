/**
 * One-time backfill: assign a default division to each cost category by code
 * range. Only fills categories where division is currently null, so any manual
 * Settings edits are preserved. Run: npx tsx scripts/backfill-divisions.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { drizzle } from "drizzle-orm/postgres-js";
import { eq, isNull, sql } from "drizzle-orm";
import postgres from "postgres";
import { costCategories } from "../src/db/schema";
import { divisionForCode } from "../src/lib/divisions";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (.env.local)");
  const client = postgres(url, { prepare: false, ssl: "require" });
  const db = drizzle(client);

  // drizzle-kit migrate hangs on the Supabase transaction pooler (no prepared
  // statements), so apply the 0001 DDL here idempotently via the working client.
  await db.execute(sql`ALTER TABLE "cost_categories" ADD COLUMN IF NOT EXISTS "division" text`);
  console.log("Ensured cost_categories.division column exists");

  const rows = await db.select().from(costCategories).where(isNull(costCategories.division));
  let updated = 0;
  for (const cat of rows) {
    const division = divisionForCode(cat.code);
    if (!division) continue;
    await db
      .update(costCategories)
      .set({ division })
      .where(eq(costCategories.id, cat.id));
    updated++;
    console.log(`  ${cat.code} ${cat.name} → ${division}`);
  }

  await client.end();
  console.log(`Backfilled ${updated} categories`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

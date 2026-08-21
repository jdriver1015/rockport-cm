/**
 * Apply migration 0042 (one live interior project per unit). drizzle-kit migrate
 * hangs on the Supabase transaction pooler, so apply it here idempotently.
 * Run: npx tsx scripts/apply-one-project-per-unit.ts
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (.env.local)");
  const client = postgres(url, { prepare: false, ssl: "require" });
  const db = drizzle(client);

  // Report offenders first: CREATE UNIQUE INDEX on dirty data fails with a
  // message that names the index, not the rows that need fixing.
  const dupes = await db.execute<{ unit_id: number; n: number }>(sql`
    SELECT unit_id, count(*)::int AS n FROM projects
    WHERE kind = 'unit' AND archived_at IS NULL AND unit_id IS NOT NULL
    GROUP BY unit_id HAVING count(*) > 1`);
  if (dupes.length > 0) {
    await client.end();
    console.error("Cannot add the index — these units already have more than one live project:");
    console.error(dupes);
    console.error("Archive the duplicates, then re-run.");
    process.exit(1);
  }

  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "projects_one_live_project_per_unit_idx"
      ON "projects" ("unit_id")
      WHERE "kind" = 'unit' AND "archived_at" IS NULL AND "unit_id" IS NOT NULL`);

  const ix = await db.execute<{ indexdef: string }>(sql`
    SELECT indexdef FROM pg_indexes
    WHERE tablename = 'projects' AND indexname = 'projects_one_live_project_per_unit_idx'`);
  await client.end();
  console.log(ix.length === 1 ? `index present: ${ix[0].indexdef}` : "MISSING");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

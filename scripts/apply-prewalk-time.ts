/**
 * Apply migration 0045 (pre-walk time + audit kind). drizzle-kit migrate hangs
 * on the Supabase transaction pooler, so apply it here idempotently.
 * Run: npx tsx scripts/apply-prewalk-time.ts
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

  await db.execute(sql`ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "pre_walk_time" time`);
  await db.execute(
    sql`ALTER TABLE "site_audits" ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'quality'`,
  );
  await db.execute(sql`ALTER TABLE "site_audits" DROP CONSTRAINT IF EXISTS "site_audits_kind"`);
  await db.execute(sql`
    ALTER TABLE "site_audits" ADD CONSTRAINT "site_audits_kind"
      CHECK ("kind" IN ('pre_walk', 'quality'))`);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "site_audits_one_prewalk_per_project_idx"
      ON "site_audits" ("project_id")
      WHERE "kind" = 'pre_walk' AND "archived_at" IS NULL AND "project_id" IS NOT NULL`);

  // Prove the constraint refuses a bad kind rather than trusting the DDL landed.
  let refused = false;
  try {
    await db.execute(sql`
      INSERT INTO site_audits (property_id, audit_date, kind)
      VALUES ((SELECT id FROM properties LIMIT 1), current_date, 'nonsense')`);
    await db.execute(sql`DELETE FROM site_audits WHERE kind = 'nonsense'`);
  } catch {
    refused = true;
  }

  const cols = await db.execute<{ table_name: string; column_name: string; data_type: string }>(sql`
    SELECT table_name, column_name, data_type FROM information_schema.columns
    WHERE (table_name = 'projects' AND column_name = 'pre_walk_time')
       OR (table_name = 'site_audits' AND column_name = 'kind')
    ORDER BY table_name`);
  const kinds = await db.execute<{ kind: string; n: number }>(sql`
    SELECT kind, count(*)::int AS n FROM site_audits GROUP BY kind`);
  await client.end();
  console.log("columns:", cols);
  console.log("existing audits by kind:", kinds);
  console.log(refused ? "kind CHECK refuses an unknown value: ok" : "WARNING: bad kind accepted");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

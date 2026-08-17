/**
 * Apply migration 0030 (project detail redesign columns). drizzle-kit migrate
 * hangs on the Supabase transaction pooler, so apply it here idempotently via
 * the same connection style as src/db/seed.ts.
 * Run: npx tsx scripts/apply-project-detail-redesign.ts
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

  await db.execute(sql`ALTER TABLE "project_milestones" ADD COLUMN IF NOT EXISTS "note" text`);
  await db.execute(
    sql`ALTER TABLE "scope_items" ADD COLUMN IF NOT EXISTS "vendor_id" integer REFERENCES "vendors"("id")`,
  );
  await db.execute(sql`ALTER TABLE "scope_items" ADD COLUMN IF NOT EXISTS "start_date" date`);
  await db.execute(sql`ALTER TABLE "scope_items" ADD COLUMN IF NOT EXISTS "end_date" date`);

  const [cols] = await db.execute<{ cols: string }>(sql`
    SELECT string_agg(table_name || '.' || column_name, ', ' ORDER BY table_name, column_name) AS cols
    FROM information_schema.columns
    WHERE (table_name = 'project_milestones' AND column_name = 'note')
       OR (table_name = 'scope_items' AND column_name IN ('vendor_id', 'start_date', 'end_date'))
  `);
  await client.end();
  console.log("applied:", cols.cols);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * Apply migration 0032 (project_milestones.is_default). drizzle-kit migrate
 * hangs on the Supabase transaction pooler, so apply it here idempotently via
 * the same connection style as src/db/seed.ts.
 * Run: npx tsx scripts/apply-milestone-is-default.ts
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

  await db.execute(
    sql`ALTER TABLE "project_milestones" ADD COLUMN IF NOT EXISTS "is_default" boolean NOT NULL DEFAULT false`,
  );

  const [row] = await db.execute<{ t: string }>(sql`
    SELECT data_type AS t FROM information_schema.columns
    WHERE table_name = 'project_milestones' AND column_name = 'is_default'`);
  await client.end();
  console.log("project_milestones.is_default:", row?.t ?? "MISSING");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

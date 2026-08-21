/**
 * Apply migration 0043 (spec_tables.version). drizzle-kit migrate hangs on the
 * Supabase transaction pooler, so apply it here idempotently.
 * Run: npx tsx scripts/apply-spec-table-version.ts
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
    sql`ALTER TABLE "spec_tables" ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1`,
  );
  const col = await db.execute<{ data_type: string; column_default: string }>(sql`
    SELECT data_type, column_default FROM information_schema.columns
    WHERE table_name = 'spec_tables' AND column_name = 'version'`);
  await client.end();
  console.log("spec_tables.version:", col.length ? col[0] : "MISSING");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

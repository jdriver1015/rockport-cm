/**
 * Apply migration 0050. drizzle-kit migrate hangs on the Supabase transaction
 * pooler, so apply it here idempotently.
 * Run: npx tsx scripts/apply-scope-confirm.ts
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

  await db.execute(sql`ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "scope_confirmed_at" timestamptz`);
  await db.execute(sql`ALTER TABLE "bids" ADD COLUMN IF NOT EXISTS "source" text NOT NULL DEFAULT 'rfp'`);
  await db.execute(sql`ALTER TABLE "bids" ADD COLUMN IF NOT EXISTS "award_reason" text`);

  await db.execute(sql`ALTER TABLE "bids" DROP CONSTRAINT IF EXISTS "bids_status"`);
  await db.execute(sql`ALTER TABLE "bids" ADD CONSTRAINT "bids_status"
    CHECK (status = ANY (ARRAY['draft','sent','received','awarded','declined','withdrawn']))`);
  await db.execute(sql`ALTER TABLE "bids" DROP CONSTRAINT IF EXISTS "bids_source"`);
  await db.execute(sql`ALTER TABLE "bids" ADD CONSTRAINT "bids_source"
    CHECK (source = ANY (ARRAY['rfp','direct']))`);
  await db.execute(sql`ALTER TABLE "bids" DROP CONSTRAINT IF EXISTS "bids_direct_needs_reason"`);
  await db.execute(sql`ALTER TABLE "bids" ADD CONSTRAINT "bids_direct_needs_reason"
    CHECK (source <> 'direct' OR (award_reason IS NOT NULL AND btrim(award_reason) <> ''))`);

  const cols = await db.execute<{ table_name: string; column_name: string; data_type: string }>(sql`
    SELECT table_name, column_name, data_type FROM information_schema.columns
    WHERE (table_name = 'projects' AND column_name = 'scope_confirmed_at')
       OR (table_name = 'bids' AND column_name IN ('source', 'award_reason'))
    ORDER BY table_name, column_name`);
  await client.end();
  console.log(cols.length === 3 ? "OK" : "MISSING SOMETHING", cols);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

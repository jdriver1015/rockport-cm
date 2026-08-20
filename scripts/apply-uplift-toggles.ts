/**
 * Apply migration 0036 (interior_budget_settings uplift toggles). drizzle-kit
 * migrate hangs on the Supabase transaction pooler, so apply it here
 * idempotently via the same connection style as src/db/seed.ts.
 * Run: npx tsx scripts/apply-uplift-toggles.ts
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
    sql`ALTER TABLE "interior_budget_settings" ADD COLUMN IF NOT EXISTS "cm_enabled" boolean NOT NULL DEFAULT true`,
  );
  await db.execute(
    sql`ALTER TABLE "interior_budget_settings" ADD COLUMN IF NOT EXISTS "contingency_enabled" boolean NOT NULL DEFAULT true`,
  );

  const rows = await db.execute<{ column_name: string; column_default: string }>(sql`
    SELECT column_name, column_default FROM information_schema.columns
    WHERE table_name = 'interior_budget_settings'
      AND column_name IN ('cm_enabled', 'contingency_enabled')
    ORDER BY column_name`);
  await client.end();
  console.log("interior_budget_settings:", rows.length === 2 ? rows : "MISSING", );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

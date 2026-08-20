/**
 * Apply migration 0041 (suggested schedule defaults). drizzle-kit migrate hangs
 * on the Supabase transaction pooler, so apply it here idempotently via the same
 * connection style as src/db/seed.ts.
 * Run: npx tsx scripts/apply-schedule-defaults.ts
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

  await db.execute(sql`
    ALTER TABLE "interior_default_settings"
      ADD COLUMN IF NOT EXISTS "schedule_enabled" boolean NOT NULL DEFAULT true`);
  await db.execute(sql`
    ALTER TABLE "interior_default_settings"
      ADD COLUMN IF NOT EXISTS "schedule_offsets" jsonb NOT NULL
      DEFAULT '{"pre_walk":2,"precon":7,"in_process":10,"punch":24,"complete":28}'::jsonb`);

  const rows = await db.execute(sql`
    SELECT schedule_enabled, schedule_offsets FROM interior_default_settings WHERE id = 1`);
  await client.end();
  console.log("interior_default_settings schedule:", rows);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * Add the non-interior budget lock — properties.budget_locked_at/by for the
 * current state, budget_lock_events for the full history behind it.
 *
 * drizzle-kit migrate hangs on the Supabase transaction pooler, and its
 * snapshots are far enough behind that db:generate emits CREATE TABLE for
 * tables that already exist. So this applies it directly, idempotently.
 *
 * Run: npx tsx scripts/apply-budget-lock.ts
 *
 * Safe to re-run: every statement is IF NOT EXISTS or guarded.
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const client = postgres(url, { prepare: false, ssl: "require", max: 1 });
  const db = drizzle(client);

  try {
    await db.execute(sql`
      DO $$ BEGIN
        CREATE TYPE "budget_lock_action" AS ENUM ('locked', 'unlocked');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);

    await db.execute(sql`
      ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "budget_locked_at" timestamp with time zone
    `);
    await db.execute(sql`
      ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "budget_locked_by" uuid REFERENCES "profiles"("id")
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "budget_lock_events" (
        "id" serial PRIMARY KEY,
        "property_id" integer NOT NULL REFERENCES "properties"("id"),
        "action" "budget_lock_action" NOT NULL,
        "user_id" uuid REFERENCES "profiles"("id"),
        "note" text,
        "created_at" timestamp with time zone NOT NULL DEFAULT now()
      );
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "budget_lock_events_property_idx"
        ON "budget_lock_events" ("property_id")
    `);
    await db.execute(sql`ALTER TABLE "budget_lock_events" ENABLE ROW LEVEL SECURITY;`);

    const propCols = await db.execute(sql`
      select column_name from information_schema.columns
      where table_name = 'properties' and column_name like 'budget_locked%'
      order by column_name
    `);
    console.log("properties lock columns:", propCols.map((r) => r.column_name).join(", ") || "none");

    const eventCols = await db.execute(sql`
      select column_name from information_schema.columns
      where table_name = 'budget_lock_events' order by ordinal_position
    `);
    console.log("budget_lock_events columns:", eventCols.map((r) => r.column_name).join(", "));
  } finally {
    await client.end();
  }
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });

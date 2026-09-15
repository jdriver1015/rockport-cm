/**
 * Add budget_line_activity_log — one row per changed field on a budget line,
 * mirroring project_activity_log's shape and reasoning for a property's
 * budget instead of a project. See drizzle/0060_nebulous_sprite.sql and
 * drizzle/0061_enable_rls_budget_activity_log.sql.
 *
 * drizzle-kit migrate hangs on the Supabase transaction pooler, and its
 * snapshots are far enough behind that db:generate emits CREATE TABLE for
 * tables that already exist. So this applies it directly, idempotently.
 *
 * Run: npx tsx scripts/apply-budget-activity-log.ts
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
      CREATE TABLE IF NOT EXISTS "budget_line_activity_log" (
        "id" serial PRIMARY KEY,
        "property_id" integer NOT NULL REFERENCES "properties"("id"),
        "budget_line_id" integer NOT NULL REFERENCES "budget_lines"("id"),
        "user_id" uuid REFERENCES "profiles"("id"),
        "field" text NOT NULL,
        "field_label" text NOT NULL,
        "from_value" text,
        "to_value" text,
        "note" text,
        "created_at" timestamp with time zone NOT NULL DEFAULT now()
      );
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "budget_line_activity_log_property_idx"
        ON "budget_line_activity_log" ("property_id")
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "budget_line_activity_log_line_idx"
        ON "budget_line_activity_log" ("budget_line_id")
    `);
    await db.execute(sql`ALTER TABLE "budget_line_activity_log" ENABLE ROW LEVEL SECURITY;`);

    const cols = await db.execute(sql`
      select column_name from information_schema.columns
      where table_name = 'budget_line_activity_log' order by ordinal_position
    `);
    console.log("budget_line_activity_log columns:", cols.map((r) => r.column_name).join(", "));
  } finally {
    await client.end();
  }
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });

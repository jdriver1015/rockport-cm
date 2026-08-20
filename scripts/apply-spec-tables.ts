/**
 * Apply migration 0039 (spec_tables). drizzle-kit migrate hangs on the Supabase
 * transaction pooler, so apply it here idempotently via the same connection
 * style as src/db/seed.ts.
 * Run: npx tsx scripts/apply-spec-tables.ts
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
    CREATE TABLE IF NOT EXISTS "spec_tables" (
      "id" serial PRIMARY KEY,
      "template_id" integer REFERENCES "budget_templates"("id") ON DELETE CASCADE,
      "budget_group_id" integer REFERENCES "budget_groups"("id") ON DELETE CASCADE,
      "kind" text NOT NULL,
      "title" text NOT NULL,
      "grid" jsonb NOT NULL DEFAULT '{"cols":[],"rows":[]}'::jsonb,
      "sort_order" integer NOT NULL DEFAULT 0,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "spec_tables_one_owner" CHECK (
        ("template_id" IS NOT NULL AND "budget_group_id" IS NULL)
        OR ("template_id" IS NULL AND "budget_group_id" IS NOT NULL)
      ),
      CONSTRAINT "spec_tables_kind" CHECK ("kind" IN ('finish', 'fixture'))
    )`);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "spec_tables_template_title_idx"
      ON "spec_tables" ("template_id", "kind", "title") WHERE "template_id" IS NOT NULL`);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "spec_tables_group_title_idx"
      ON "spec_tables" ("budget_group_id", "kind", "title") WHERE "budget_group_id" IS NOT NULL`);

  // Prove the constraints hold, rather than trusting IF NOT EXISTS on a table
  // that may predate them.
  const probes = [
    ["both owners", sql`INSERT INTO spec_tables (template_id, budget_group_id, kind, title) VALUES (1, 1, 'finish', 'probe')`],
    ["no owner", sql`INSERT INTO spec_tables (kind, title) VALUES ('finish', 'probe')`],
    ["bad kind", sql`INSERT INTO spec_tables (template_id, kind, title) VALUES (1, 'nonsense', 'probe')`],
  ] as const;
  for (const [label, stmt] of probes) {
    try {
      await db.execute(stmt);
      console.log(`WARNING: ${label} was ACCEPTED`);
      await db.execute(sql`DELETE FROM spec_tables WHERE title = 'probe'`);
    } catch {
      console.log(`refuses ${label}: ok`);
    }
  }

  const cols = await db.execute<{ column_name: string }>(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'spec_tables' ORDER BY ordinal_position`);
  await client.end();
  console.log("spec_tables:", cols.map((c) => c.column_name).join(", "));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * Apply migration 0038 (trade_scopes). drizzle-kit migrate hangs on the Supabase
 * transaction pooler, so apply it here idempotently via the same connection
 * style as src/db/seed.ts.
 * Run: npx tsx scripts/apply-trade-scopes.ts
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
    CREATE TABLE IF NOT EXISTS "trade_scopes" (
      "id" serial PRIMARY KEY,
      "template_id" integer REFERENCES "budget_templates"("id") ON DELETE CASCADE,
      "budget_group_id" integer REFERENCES "budget_groups"("id") ON DELETE CASCADE,
      "heading" text NOT NULL,
      "body" text,
      "sort_order" integer NOT NULL DEFAULT 0,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "trade_scopes_one_owner" CHECK (
        ("template_id" IS NOT NULL AND "budget_group_id" IS NULL)
        OR ("template_id" IS NULL AND "budget_group_id" IS NOT NULL)
      )
    )`);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "trade_scopes_template_heading_idx"
      ON "trade_scopes" ("template_id", "heading") WHERE "template_id" IS NOT NULL`);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "trade_scopes_group_heading_idx"
      ON "trade_scopes" ("budget_group_id", "heading") WHERE "budget_group_id" IS NOT NULL`);

  // Prove the CHECK actually refuses the two bad shapes, rather than trusting
  // that CREATE TABLE IF NOT EXISTS applied it to a table that already existed.
  for (const [label, stmt] of [
    ["both owners", sql`INSERT INTO trade_scopes (template_id, budget_group_id, heading) VALUES (1, 1, 'probe')`],
    ["no owner", sql`INSERT INTO trade_scopes (heading) VALUES ('probe')`],
  ] as const) {
    try {
      await db.execute(stmt);
      console.log(`WARNING: ${label} was ACCEPTED — the one-owner CHECK is missing`);
      await db.execute(sql`DELETE FROM trade_scopes WHERE heading = 'probe'`);
    } catch {
      console.log(`one-owner CHECK refuses ${label}: ok`);
    }
  }

  const cols = await db.execute<{ column_name: string }>(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'trade_scopes' ORDER BY ordinal_position`);
  await client.end();
  console.log("trade_scopes:", cols.map((c) => c.column_name).join(", "));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

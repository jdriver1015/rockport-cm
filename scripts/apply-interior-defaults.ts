/**
 * Apply migration 0037 (portfolio interior defaults). drizzle-kit migrate hangs
 * on the Supabase transaction pooler, so apply it here idempotently via the same
 * connection style as src/db/seed.ts.
 * Run: npx tsx scripts/apply-interior-defaults.ts
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
    sql`ALTER TABLE "budget_templates" ADD COLUMN IF NOT EXISTS "seed_by_default" boolean NOT NULL DEFAULT false`,
  );
  await db.execute(sql`
    UPDATE "budget_templates" SET "seed_by_default" = true
    WHERE "name" IN ('Enhanced', 'Signature') AND "archived_at" IS NULL`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "interior_default_settings" (
      "id" integer PRIMARY KEY DEFAULT 1 CONSTRAINT "interior_default_settings_singleton" CHECK ("id" = 1),
      "cm_supervision_pct" numeric(6,3) NOT NULL DEFAULT '0',
      "contingency_pct" numeric(6,3) NOT NULL DEFAULT '0',
      "cm_enabled" boolean NOT NULL DEFAULT true,
      "contingency_enabled" boolean NOT NULL DEFAULT true,
      "cm_cost_code_ref" text,
      "contingency_cost_code_ref" text,
      "updated_at" timestamptz NOT NULL DEFAULT now()
    )`);
  await db.execute(
    sql`INSERT INTO "interior_default_settings" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING`,
  );

  const seeded = await db.execute<{ name: string }>(
    sql`SELECT name FROM budget_templates WHERE seed_by_default ORDER BY sort_order`,
  );
  const defaults = await db.execute(sql`SELECT * FROM interior_default_settings`);
  await client.end();
  console.log("seed_by_default:", seeded.map((r) => r.name));
  console.log("interior_default_settings:", defaults);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * Apply the scope_items table (migration 0002). drizzle-kit migrate hangs on
 * the Supabase transaction pooler, so create it here idempotently via the same
 * connection style as src/db/seed.ts. Run: npx tsx scripts/apply-scope-table.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (.env.local)");
  const client = postgres(url, { prepare: false, ssl: "require" });
  const db = drizzle(client);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "scope_items" (
      "id" serial PRIMARY KEY NOT NULL,
      "project_id" integer NOT NULL REFERENCES "projects"("id"),
      "item" text NOT NULL,
      "quantity" numeric(12, 2),
      "unit_cost" numeric(12, 2),
      "vendor" text,
      "status" text DEFAULT 'planned' NOT NULL,
      "sort_order" integer DEFAULT 0 NOT NULL,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL
    )
  `);

  const [{ count }] = await db.execute<{ count: number }>(
    sql`SELECT count(*)::int AS count FROM scope_items`,
  );
  await client.end();
  console.log(`scope_items ready (rows: ${count})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

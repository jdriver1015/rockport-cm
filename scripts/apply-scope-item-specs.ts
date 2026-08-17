/**
 * Apply migration 0031 (scope_items.specs). drizzle-kit migrate hangs on the
 * Supabase transaction pooler, so apply it here idempotently via the same
 * connection style as src/db/seed.ts.
 * Run: npx tsx scripts/apply-scope-item-specs.ts
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

  await db.execute(sql`ALTER TABLE "scope_items" ADD COLUMN IF NOT EXISTS "specs" jsonb`);

  const [row] = await db.execute<{ ok: string }>(sql`
    SELECT data_type AS ok FROM information_schema.columns
    WHERE table_name = 'scope_items' AND column_name = 'specs'
  `);
  await client.end();
  console.log("scope_items.specs:", row?.ok ?? "MISSING");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

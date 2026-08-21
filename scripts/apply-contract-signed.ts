/**
 * Apply migration 0049 (projects.contract_signed_at). drizzle-kit migrate hangs
 * on the Supabase transaction pooler, so apply it here idempotently.
 * Run: npx tsx scripts/apply-contract-signed.ts
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

  await db.execute(sql`ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "contract_signed_at" date`);
  const col = await db.execute<{ column_name: string; data_type: string }>(sql`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_name = 'projects' AND column_name = 'contract_signed_at'`);
  await client.end();
  console.log("projects.contract_signed_at:", col.length ? col[0] : "MISSING");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

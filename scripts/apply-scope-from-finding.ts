/**
 * Apply migration 0047 (scope_items.source_finding_id). drizzle-kit migrate
 * hangs on the Supabase transaction pooler, so apply it here idempotently.
 * Run: npx tsx scripts/apply-scope-from-finding.ts
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
    ALTER TABLE "scope_items"
      ADD COLUMN IF NOT EXISTS "source_finding_id" integer
      REFERENCES "audit_findings"("id") ON DELETE SET NULL`);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "scope_items_source_finding_idx"
      ON "scope_items" ("source_finding_id") WHERE "source_finding_id" IS NOT NULL`);

  const col = await db.execute<{ column_name: string; is_nullable: string }>(sql`
    SELECT column_name, is_nullable FROM information_schema.columns
    WHERE table_name = 'scope_items' AND column_name = 'source_finding_id'`);
  const rule = await db.execute<{ confdeltype: string }>(sql`
    SELECT confdeltype FROM pg_constraint
    WHERE conrelid = 'scope_items'::regclass AND confrelid = 'audit_findings'::regclass`);
  await client.end();
  console.log("column:", col.length ? col[0] : "MISSING");
  // 'n' is SET NULL. 'c' would be CASCADE, which would delete work.
  console.log("on delete:", rule.length ? (rule[0].confdeltype === "n" ? "SET NULL (correct)" : rule[0].confdeltype) : "MISSING");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

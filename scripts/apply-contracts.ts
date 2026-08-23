/**
 * Apply migration 0051 (contract_templates, project_contracts) and seed a
 * starter template. drizzle-kit migrate hangs on the Supabase transaction
 * pooler, so apply it here idempotently.
 * Run: npx tsx scripts/apply-contracts.ts
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { STARTER_TEMPLATE } from "../src/lib/contract-template-starter";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (.env.local)");
  const client = postgres(url, { prepare: false, ssl: "require" });
  const db = drizzle(client);

  // The file is idempotent throughout, so replaying it is safe. Split on the
  // statement boundary postgres-js needs; it will not take a multi-statement
  // string through the pooler.
  const file = readFileSync("drizzle/0051_contracts.sql", "utf8");
  const statements = file
    .split(/;\s*$/m)
    .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
    .filter(Boolean);
  for (const stmt of statements) {
    await db.execute(sql.raw(stmt));
  }

  const [{ n }] = await db.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM contract_templates WHERE archived_at IS NULL`,
  );
  if (n === 0) {
    await db.execute(sql`
      INSERT INTO contract_templates (name, body, is_default)
      VALUES ('Standard subcontract', ${STARTER_TEMPLATE}, true)`);
    console.log("seeded the starter template");
  }

  const tables = await db.execute<{ table_name: string }>(sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_name IN ('contract_templates', 'project_contracts') ORDER BY table_name`);
  await client.end();
  console.log(tables.length === 2 ? "OK" : "MISSING SOMETHING", tables);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

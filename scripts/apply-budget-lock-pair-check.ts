/**
 * Add a CHECK constraint tying properties.budget_locked_at and
 * budget_locked_by together — always both null or both set.
 *
 * applyBudgetLockChange (the only writer) already keeps them in sync, but
 * nothing at the schema level enforced it, so a future hand-run fix or a
 * different code path could silently leave one set and the other null.
 *
 * drizzle-kit migrate hangs on the Supabase transaction pooler, and its
 * snapshots are far enough behind that db:generate emits CREATE TABLE for
 * tables that already exist. So this applies it directly, idempotently.
 *
 * Run: npx tsx scripts/apply-budget-lock-pair-check.ts
 *
 * Safe to re-run: the constraint is dropped IF EXISTS before being re-added.
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
    // Refuse to proceed if any existing row would violate the constraint —
    // the constraint could not be added and something upstream would need
    // fixing first.
    const violations = await db.execute(sql`
      select id from properties
      where (budget_locked_at is null) <> (budget_locked_by is null)
    `);
    if (violations.length > 0) {
      console.error("Refusing: these properties already have mismatched lock columns:");
      console.error(violations);
      process.exit(1);
    }

    await db.execute(sql`ALTER TABLE "properties" DROP CONSTRAINT IF EXISTS "properties_budget_lock_pair_ck"`);
    await db.execute(sql`
      ALTER TABLE "properties" ADD CONSTRAINT "properties_budget_lock_pair_ck"
        CHECK ((budget_locked_at is null) = (budget_locked_by is null))
    `);

    const after = await db.execute(sql`
      select conname from pg_constraint where conname = 'properties_budget_lock_pair_ck'
    `);
    console.log("constraint present:", after.length > 0);
  } finally {
    await client.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

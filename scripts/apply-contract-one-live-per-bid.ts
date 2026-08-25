/**
 * Move the "one live contract" rule from the project to the award.
 *
 * 0051 created:
 *   UNIQUE (project_id) WHERE status <> 'voided'
 * with the note "two live contracts for one unit is a mistake, not a workflow",
 * which was true while a project had a single winner. A project can now award
 * its siding to one sub and its roofing to another and contract both, so the
 * thing that must not be duplicated is the bid, not the project.
 *
 * drizzle-kit migrate hangs on the Supabase transaction pooler — and its
 * snapshots are far enough behind that `db:generate` emits CREATE TABLE for
 * tables that already exist — so apply this here, idempotently.
 *
 * Run: npx tsx scripts/apply-contract-one-live-per-bid.ts
 *
 * Safe to re-run: the drop is IF EXISTS and the create is IF NOT EXISTS.
 * Nothing is deleted; an index is not data.
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
    // Refuse to proceed if any bid already holds two live contracts — the new
    // index could not be built and something upstream would need fixing first.
    const clashes = await db.execute(sql`
      select bid_id, count(*)::int as n
      from project_contracts
      where status <> 'voided'
      group by bid_id
      having count(*) > 1
    `);
    if (clashes.length > 0) {
      console.error("Refusing: these bids already have more than one live contract:");
      console.error(clashes);
      process.exit(1);
    }

    await db.execute(sql`DROP INDEX IF EXISTS "project_contracts_one_live"`);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS "project_contracts_one_live_per_bid"
        ON "project_contracts" ("bid_id") WHERE status <> 'voided'
    `);

    const after = await db.execute(sql`
      select indexname from pg_indexes
      where tablename = 'project_contracts' and indexname like '%one_live%'
    `);
    console.log("indexes now:", after.map((r) => r.indexname).join(", ") || "none");
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

/**
 * Add bid_events and bids.due_date.
 *
 * Sending a bid request was a black hole — the row said "sent" and nothing
 * afterwards said whether anybody opened it, looked at the scope or started
 * pricing. bid_events is the append-only trail behind that, and due_date is the
 * question every vendor asks first.
 *
 * drizzle-kit migrate hangs on the Supabase transaction pooler, and its
 * snapshots are far enough behind that db:generate emits CREATE TABLE for
 * tables that already exist — see the notes on apply-contract-one-live-per-bid.
 * So this applies it directly, idempotently.
 *
 * Run: npx tsx scripts/apply-bid-events.ts
 *
 * Safe to re-run: every statement is IF NOT EXISTS or guarded.
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
    await db.execute(sql`
      DO $$ BEGIN
        CREATE TYPE "bid_event_kind" AS ENUM (
          'invited', 'email_opened', 'link_opened', 'priced', 'submitted', 'revoked'
        );
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "bid_events" (
        "id" serial PRIMARY KEY,
        "bid_id" integer NOT NULL REFERENCES "bids"("id") ON DELETE CASCADE,
        "kind" "bid_event_kind" NOT NULL,
        "at" timestamp with time zone NOT NULL DEFAULT now(),
        "meta" jsonb
      );
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "bid_events_bid_idx" ON "bid_events" ("bid_id", "at");
    `);

    await db.execute(sql`ALTER TABLE "bids" ADD COLUMN IF NOT EXISTS "due_date" date;`);

    // The app reaches this table only through the Drizzle superuser role, same
    // as every other table, so RLS with no policy is the right posture — the
    // PostgREST surface should not see bid activity.
    await db.execute(sql`ALTER TABLE "bid_events" ENABLE ROW LEVEL SECURITY;`);

    const cols = await db.execute(sql`
      select column_name from information_schema.columns
      where table_name = 'bid_events' order by ordinal_position
    `);
    console.log("bid_events:", cols.map((r) => r.column_name).join(", "));

    const due = await db.execute(sql`
      select column_name from information_schema.columns
      where table_name = 'bids' and column_name = 'due_date'
    `);
    console.log("bids.due_date:", due.length ? "present" : "MISSING");
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

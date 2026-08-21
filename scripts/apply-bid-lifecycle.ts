/**
 * Apply migration 0046 (bid lifecycle). drizzle-kit migrate hangs on the
 * Supabase transaction pooler, so apply it here idempotently.
 * Run: npx tsx scripts/apply-bid-lifecycle.ts
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

  await db.execute(sql`ALTER TABLE "bids" ADD COLUMN IF NOT EXISTS "sent_at" timestamptz`);
  await db.execute(
    sql`ALTER TABLE "bids" ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'draft'`,
  );
  await db.execute(sql`ALTER TABLE "bids" DROP CONSTRAINT IF EXISTS "bids_status"`);
  await db.execute(sql`
    ALTER TABLE "bids" ADD CONSTRAINT "bids_status"
      CHECK ("status" IN ('draft', 'sent', 'received', 'awarded', 'declined'))`);
  await db.execute(sql`
    UPDATE "bids" SET "status" = CASE WHEN "approved" THEN 'awarded' ELSE 'received' END
    WHERE "status" = 'draft'`);
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS "bids_project_status_idx" ON "bids" ("project_id", "status")`,
  );

  const rows = await db.execute<{ status: string; n: number }>(
    sql`SELECT status, count(*)::int AS n FROM bids GROUP BY status ORDER BY status`,
  );
  // approved and status must agree, or the gate and the list disagree about
  // which bid won.
  const mismatch = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM bids
    WHERE (approved AND status <> 'awarded') OR (NOT approved AND status = 'awarded')`);
  await client.end();
  console.log("bids by status:", rows.length ? rows : "(no bids yet)");
  console.log(mismatch[0].n === 0 ? "approved and status agree" : `PROBLEM: ${mismatch[0].n} disagree`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

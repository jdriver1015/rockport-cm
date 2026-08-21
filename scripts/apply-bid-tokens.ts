/**
 * Apply migration 0048 (bid access tokens). drizzle-kit migrate hangs on the
 * Supabase transaction pooler, so apply it here idempotently.
 * Run: npx tsx scripts/apply-bid-tokens.ts
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
    CREATE TABLE IF NOT EXISTS "bid_access_tokens" (
      "id" serial PRIMARY KEY,
      "bid_id" integer NOT NULL REFERENCES "bids"("id") ON DELETE CASCADE,
      "token" text NOT NULL,
      "expires_at" timestamptz NOT NULL,
      "revoked_at" timestamptz,
      "created_by" uuid REFERENCES "profiles"("id"),
      "created_at" timestamptz NOT NULL DEFAULT now()
    )`);
  await db.execute(
    sql`CREATE UNIQUE INDEX IF NOT EXISTS "bid_access_tokens_token_idx" ON "bid_access_tokens" ("token")`,
  );
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "bid_access_tokens_one_live_per_bid_idx"
      ON "bid_access_tokens" ("bid_id") WHERE "revoked_at" IS NULL`);

  // Prove both uniqueness rules, since they are the whole security model.
  const [bid] = await db.execute<{ id: number }>(sql`SELECT id FROM bids LIMIT 1`);
  const results: string[] = [];
  if (bid) {
    await db.execute(sql`
      INSERT INTO bid_access_tokens (bid_id, token, expires_at)
      VALUES (${bid.id}, 'PROBE-token-a', now() + interval '1 day')`);
    try {
      await db.execute(sql`
        INSERT INTO bid_access_tokens (bid_id, token, expires_at)
        VALUES (${bid.id}, 'PROBE-token-b', now() + interval '1 day')`);
      results.push("PROBLEM: a second live token for the same bid was accepted");
    } catch {
      results.push("one-live-token-per-bid enforced: ok");
    }
    // Revoking the first must free the slot.
    await db.execute(sql`UPDATE bid_access_tokens SET revoked_at = now() WHERE token = 'PROBE-token-a'`);
    try {
      await db.execute(sql`
        INSERT INTO bid_access_tokens (bid_id, token, expires_at)
        VALUES (${bid.id}, 'PROBE-token-c', now() + interval '1 day')`);
      results.push("revoking frees the slot for a reissue: ok");
    } catch {
      results.push("PROBLEM: could not reissue after revoking");
    }
    await db.execute(sql`DELETE FROM bid_access_tokens WHERE token LIKE 'PROBE-%'`);
  }

  const left = await db.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM bid_access_tokens WHERE token LIKE 'PROBE-%'`,
  );
  await client.end();
  for (const r of results) console.log(r);
  console.log(`probe tokens left: ${left[0].n}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

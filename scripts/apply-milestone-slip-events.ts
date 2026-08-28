/**
 * Add milestone_slip_events — the audit trail behind auto-pushed targets.
 *
 * Target dates now move on their own when a phase is missed, which is only safe
 * because nothing is lost when they do: every move is recorded here. This is
 * also the post-mortem dataset — average slip per phase, worst offenders, trend
 * over time — and it makes the original commitment recoverable without storing
 * it, since the earliest event's from_date for a milestone IS what was first
 * planned.
 *
 * drizzle-kit migrate hangs on the Supabase transaction pooler, and its
 * snapshots are far enough behind that db:generate emits CREATE TABLE for
 * tables that already exist. So this applies it directly, idempotently.
 *
 * Run: npx tsx scripts/apply-milestone-slip-events.ts
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
        CREATE TYPE "slip_reason" AS ENUM ('missed', 'rebased');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "milestone_slip_events" (
        "id" serial PRIMARY KEY,
        "project_id" integer NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
        "milestone_id" integer NOT NULL REFERENCES "project_milestones"("id") ON DELETE CASCADE,
        "phase" "project_phase" NOT NULL,
        "from_date" date NOT NULL,
        "to_date" date NOT NULL,
        -- Business days, not calendar days: a Friday miss noticed on Monday is
        -- one working day lost, not three.
        "days" integer NOT NULL,
        "reason" "slip_reason" NOT NULL,
        "at" timestamp with time zone NOT NULL DEFAULT now()
      );
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "milestone_slip_events_project_idx"
        ON "milestone_slip_events" ("project_id", "at");
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "milestone_slip_events_phase_idx"
        ON "milestone_slip_events" ("phase", "at");
    `);

    await db.execute(sql`ALTER TABLE "milestone_slip_events" ENABLE ROW LEVEL SECURITY;`);

    const cols = await db.execute(sql`
      select column_name from information_schema.columns
      where table_name = 'milestone_slip_events' order by ordinal_position
    `);
    console.log("milestone_slip_events:", cols.map((r) => r.column_name).join(", "));
  } finally {
    await client.end();
  }
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });

/**
 * Apply migration 0033 (rename the four default milestones, clear derived
 * pre-con dates). drizzle-kit migrate hangs on the Supabase transaction pooler,
 * so apply it here idempotently via the same connection style as src/db/seed.ts.
 * Run: npx tsx scripts/apply-rename-default-milestones.ts
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { DEFAULT_MILESTONES } from "../src/lib/milestones";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (.env.local)");
  const client = postgres(url, { prepare: false, ssl: "require" });
  const db = drizzle(client);

  for (const m of DEFAULT_MILESTONES) {
    const res = await db.execute(sql`
      UPDATE project_milestones SET label = ${m.label}
      WHERE is_default AND phase = ${m.phase}::project_phase AND label <> ${m.label}
      RETURNING id`);
    console.log(`${m.phase} -> "${m.label}": ${(res as unknown as unknown[]).length} renamed`);
  }

  const clearedActual = await db.execute(sql`
    UPDATE project_milestones m SET actual_date = NULL
    FROM projects p
    WHERE p.id = m.project_id AND m.is_default AND m.phase = 'precon'
      AND m.actual_date = p.created_at::date
    RETURNING m.id`);
  const clearedPlanned = await db.execute(sql`
    UPDATE project_milestones m SET planned_date = NULL
    FROM projects p
    WHERE p.id = m.project_id AND m.is_default AND m.phase = 'precon'
      AND m.planned_date IS NOT NULL AND m.planned_date = p.pre_walk_date
    RETURNING m.id`);
  console.log(`cleared derived Contract Signed dates: ${(clearedActual as unknown as unknown[]).length} actual, ${(clearedPlanned as unknown as unknown[]).length} planned`);

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

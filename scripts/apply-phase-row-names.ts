/**
 * Apply migration 0044 (seeded rows take their phase's name). drizzle-kit
 * migrate hangs on the Supabase transaction pooler, so apply it here
 * idempotently — the UPDATE is a no-op on a second run.
 * Run: npx tsx scripts/apply-phase-row-names.ts
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

  const before = await db.execute<{ label: string; n: number }>(sql`
    SELECT label, count(*)::int AS n FROM project_milestones
    WHERE is_default = true GROUP BY label ORDER BY label`);
  console.log("before:", before);

  await db.execute(sql`
    UPDATE project_milestones
    SET label = CASE phase
        WHEN 'precon' THEN 'Pre-Construction'
        WHEN 'in_process' THEN 'In Process'
        WHEN 'punch' THEN 'Punch and Sign Off'
        WHEN 'complete' THEN 'Complete'
        ELSE label
      END
    WHERE is_default = true AND phase IS NOT NULL`);

  const after = await db.execute<{ label: string; n: number }>(sql`
    SELECT label, count(*)::int AS n FROM project_milestones
    WHERE is_default = true GROUP BY label ORDER BY label`);
  console.log("after: ", after);

  // A seeded row whose label no longer matches its phase means the CASE missed
  // a phase value — worth knowing rather than discovering on a screen.
  const stray = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM project_milestones
    WHERE is_default = true AND phase IS NOT NULL AND label NOT IN
      ('Pre-Construction', 'In Process', 'Punch and Sign Off', 'Complete')`);
  await client.end();
  console.log(stray[0].n === 0 ? "every seeded row matches its phase" : `PROBLEM: ${stray[0].n} rows unmatched`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

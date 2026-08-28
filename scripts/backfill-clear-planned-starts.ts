/**
 * WRITES. Clears leftover planned dates out of `projects.start_date`.
 *
 * Before target phasing, the interior wizard wrote the PLANNED In Process date
 * into `projects.start_date`, and entry into In Process wrote the REAL one into
 * the same column. The column now means the real one only, so a project still in
 * pre-con carrying a start date is holding a plan that would read as "started".
 *
 * Two steps, in this order:
 *   1. Any pre-con project whose In Process milestone has no target gets the
 *      start_date copied onto it, so the plan survives where the plan now lives.
 *   2. start_date is then cleared on every pre-con project.
 *
 * Projects past pre-con are left alone — their start date is a real one.
 *
 * Run the report first:  npx tsx scripts/report-planned-start-dates.ts
 *   npx tsx scripts/backfill-clear-planned-starts.ts          (dry run)
 *   npx tsx scripts/backfill-clear-planned-starts.ts --apply  (writes)
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { and, eq, isNull, isNotNull } from "drizzle-orm";
import { db, schema } from "../src/db";

const APPLY = process.argv.includes("--apply");

async function main() {
  const stale = await db()
    .select({
      id: schema.projects.id,
      name: schema.projects.name,
      startDate: schema.projects.startDate,
    })
    .from(schema.projects)
    .where(
      and(
        isNull(schema.projects.archivedAt),
        isNotNull(schema.projects.startDate),
        eq(schema.projects.phase, "precon"),
      ),
    );

  if (stale.length === 0) {
    console.log("Nothing to do — no pre-con project carries a start date.");
    return;
  }

  const targets = await db()
    .select({
      id: schema.projectMilestones.id,
      projectId: schema.projectMilestones.projectId,
      plannedDate: schema.projectMilestones.plannedDate,
    })
    .from(schema.projectMilestones)
    .where(
      and(
        eq(schema.projectMilestones.phase, "in_process"),
        eq(schema.projectMilestones.isDefault, true),
        isNull(schema.projectMilestones.archivedAt),
      ),
    );
  const milestoneOf = new Map(targets.map((t) => [t.projectId, t]));

  let rescued = 0;
  let cleared = 0;

  for (const p of stale) {
    const milestone = milestoneOf.get(p.id);

    // Step 1 — do not drop a date that exists nowhere else.
    if (milestone && !milestone.plannedDate) {
      console.log(`  #${p.id} ${p.name}: copying ${p.startDate} onto the In Process target`);
      if (APPLY) {
        await db()
          .update(schema.projectMilestones)
          .set({ plannedDate: p.startDate })
          .where(eq(schema.projectMilestones.id, milestone.id));
      }
      rescued++;
    } else if (!milestone) {
      // No seeded row at all. Leave the project alone rather than losing the
      // date — backfill-default-milestones.ts seeds the rows this needs.
      console.log(`  #${p.id} ${p.name}: SKIPPED, no seeded In Process milestone to hold the date`);
      continue;
    }

    console.log(`  #${p.id} ${p.name}: clearing start_date ${p.startDate}`);
    if (APPLY) {
      await db()
        .update(schema.projects)
        .set({ startDate: null })
        .where(eq(schema.projects.id, p.id));
    }
    cleared++;
  }

  console.log(
    `\n${APPLY ? "Applied" : "Dry run"}: ${rescued} target(s) rescued, ${cleared} start date(s) cleared.`,
  );
  if (!APPLY) console.log("Re-run with --apply to write.");
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });

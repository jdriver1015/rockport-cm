/**
 * READ-ONLY. What the target-phasing change means for data already in the table.
 *
 * `projects.start_date` used to receive the PLANNED In Process date at creation
 * and the REAL one on entry to In Process. It now means the real one only. Any
 * project created before the change is carrying whichever of the two it got, and
 * this report says which — because a plan sitting in a column now read as an
 * actual would show a turn as started when nobody has touched it.
 *
 * The tell is the phase: a project still in pre-con cannot have really started,
 * so a start_date on one of those is a leftover plan.
 *
 *   npx tsx scripts/report-planned-start-dates.ts
 *
 * Changes nothing. See backfill-clear-planned-starts.ts for the fix.
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { and, eq, isNull, isNotNull } from "drizzle-orm";
import { db, schema } from "../src/db";

async function main() {
  const rows = await db()
    .select({
      id: schema.projects.id,
      name: schema.projects.name,
      phase: schema.projects.phase,
      startDate: schema.projects.startDate,
      targetCompletionDate: schema.projects.targetCompletionDate,
      completeDate: schema.projects.completeDate,
    })
    .from(schema.projects)
    .where(and(isNull(schema.projects.archivedAt), isNotNull(schema.projects.startDate)));

  const stale = rows.filter((r) => r.phase === "precon");
  const real = rows.filter((r) => r.phase !== "precon");

  console.log(`\n${rows.length} active project(s) carry a start date.\n`);

  console.log(`${real.length} are past pre-con — their start date is a real start, left alone:`);
  for (const r of real.slice(0, 10)) {
    console.log(`  #${r.id} ${r.name} — ${r.phase}, started ${r.startDate}`);
  }
  if (real.length > 10) console.log(`  … and ${real.length - 10} more`);

  console.log(
    `\n${stale.length} are still in pre-con — work has not begun, so the date is a leftover plan:`,
  );
  for (const r of stale) {
    console.log(`  #${r.id} ${r.name} — start_date ${r.startDate} would read as "started"`);
  }

  // The planned dates these projects should be showing instead.
  if (stale.length > 0) {
    const targets = await db()
      .select({
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
    const byProject = new Map(targets.map((t) => [t.projectId, t.plannedDate]));
    const covered = stale.filter((r) => byProject.get(r.id));
    console.log(
      `\n  ${covered.length} of those ${stale.length} already carry the same plan on their In Process`,
    );
    console.log("  milestone, so clearing start_date loses nothing:");
    for (const r of covered) {
      const t = byProject.get(r.id);
      console.log(
        `    #${r.id} start_date ${r.startDate} · milestone target ${t}${
          t === r.startDate ? "  (identical)" : "  (differs — milestone wins)"
        }`,
      );
    }
    const uncovered = stale.filter((r) => !byProject.get(r.id));
    if (uncovered.length > 0) {
      console.log(`\n  ${uncovered.length} have NO milestone target — clearing would lose the date:`);
      for (const r of uncovered) console.log(`    #${r.id} ${r.name} — ${r.startDate}`);
      console.log("  The backfill copies these onto the milestone before clearing.");
    }
  }

  console.log("\nNothing was changed.\n");
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });

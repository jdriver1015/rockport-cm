/**
 * WRITES. Lays a sensible target phasing over every active project.
 *
 * The existing plan was assembled by hand and by earlier backfills, and it
 * contradicts itself: Unit 001 targets In Process three weeks BEFORE
 * Pre-Construction, Unit 003 carries an actual Complete date while the project
 * still sits in pre-con, and four of seven projects have only one phase dated.
 * Phase banding on the Gantt makes all of that plainly visible, which is the
 * argument for fixing it rather than for hiding it.
 *
 * The shape comes from the portfolio default (see DEFAULT_SCHEDULE_OFFSETS):
 * three days of pre-con, two weeks of work, four days of punch, then complete.
 * Every date is rolled off a weekend, because nobody mobilises on a Saturday.
 *
 * The anchor is whatever the project already knows about itself, most reliable
 * first: a real pre-con date beats a real start beats a planned date beats the
 * pre-walk. So a project that genuinely started on the 6th keeps a plan built
 * around the 6th rather than being shoved onto a generic calendar.
 *
 * Actuals are left alone with one exception: an actual date on a phase the
 * project has not reached cannot have happened, and is cleared.
 *
 *   npx tsx scripts/reseed-phase-targets.ts           (dry run)
 *   npx tsx scripts/reseed-phase-targets.ts --apply
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { and, asc, eq, isNull } from "drizzle-orm";
import { db, schema } from "../src/db";
import {
  PHASE_KEYS,
  dateFromIso,
  nextWeekday,
  toIsoDate,
  todayInBusinessZone,
} from "../src/lib/schedule-defaults";
import { phaseIndex } from "../src/lib/stages";
import type { ProjectPhaseKey } from "../src/lib/stages";

const APPLY = process.argv.includes("--apply");

/** Days after the phase before it. Pre-con is the anchor, so it has none. */
const GAP: Record<ProjectPhaseKey, number> = {
  precon: 0,
  in_process: 3,
  punch: 14,
  complete: 4,
};

function plus(iso: string, days: number): string {
  const d = dateFromIso(iso);
  return toIsoDate(nextWeekday(new Date(d.getFullYear(), d.getMonth(), d.getDate() + days)));
}

async function main() {
  const projects = await db()
    .select({
      id: schema.projects.id,
      name: schema.projects.name,
      phase: schema.projects.phase,
      preWalkDate: schema.projects.preWalkDate,
      startDate: schema.projects.startDate,
    })
    .from(schema.projects)
    .where(isNull(schema.projects.archivedAt))
    .orderBy(asc(schema.projects.id));

  const today = toIsoDate(todayInBusinessZone());
  let planned = 0;
  let cleared = 0;

  for (const p of projects) {
    const rows = await db()
      .select({
        id: schema.projectMilestones.id,
        phase: schema.projectMilestones.phase,
        plannedDate: schema.projectMilestones.plannedDate,
        actualDate: schema.projectMilestones.actualDate,
      })
      .from(schema.projectMilestones)
      .where(
        and(
          eq(schema.projectMilestones.projectId, p.id),
          eq(schema.projectMilestones.isDefault, true),
          isNull(schema.projectMilestones.archivedAt),
        ),
      );
    const byPhase = new Map(rows.filter((r) => r.phase).map((r) => [r.phase as ProjectPhaseKey, r]));
    if (byPhase.size === 0) {
      console.log(`  #${p.id} ${p.name}: no seeded phase rows, skipped`);
      continue;
    }

    // Most reliable anchor available, converted to a pre-con start.
    const anchor =
      byPhase.get("precon")?.actualDate ??
      (byPhase.get("in_process")?.actualDate ? plus(byPhase.get("in_process")!.actualDate!, -GAP.in_process) : null) ??
      (p.startDate ? plus(p.startDate, -GAP.in_process) : null) ??
      byPhase.get("precon")?.plannedDate ??
      (byPhase.get("in_process")?.plannedDate ? plus(byPhase.get("in_process")!.plannedDate!, -GAP.in_process) : null) ??
      (p.preWalkDate ? plus(p.preWalkDate, 2) : null) ??
      today;

    const dates: Record<ProjectPhaseKey, string> = {} as Record<ProjectPhaseKey, string>;
    let cursor = toIsoDate(nextWeekday(dateFromIso(anchor)));
    for (const key of PHASE_KEYS) {
      cursor = GAP[key] === 0 ? cursor : plus(cursor, GAP[key]);
      dates[key] = cursor;
    }

    console.log(
      `  #${String(p.id).padStart(2)} ${p.name.slice(0, 22).padEnd(22)} ` +
        PHASE_KEYS.map((k) => `${k}=${dates[k]}`).join(" "),
    );

    for (const key of PHASE_KEYS) {
      const row = byPhase.get(key);
      if (!row) continue;
      const patch: { plannedDate: string; actualDate?: null } = { plannedDate: dates[key] };

      // An actual on a phase the project has not reached did not happen.
      if (row.actualDate && phaseIndex(key) > phaseIndex(p.phase)) {
        console.log(`        clearing impossible ${key} actual ${row.actualDate} (project is in ${p.phase})`);
        patch.actualDate = null;
        cleared++;
      }
      if (APPLY) {
        await db()
          .update(schema.projectMilestones)
          .set(patch)
          .where(eq(schema.projectMilestones.id, row.id));
      }
      planned++;
    }
  }

  console.log(`\n${APPLY ? "Applied" : "Dry run"}: ${planned} target(s) set, ${cleared} impossible actual(s) cleared.`);
  if (!APPLY) console.log("Re-run with --apply to write.");
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });

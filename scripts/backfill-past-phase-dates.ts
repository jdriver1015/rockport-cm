/**
 * Guess planned/actual dates for the default phase milestones a project has
 * already moved past but never had dates recorded for — the gap that draws
 * the alert icon on the phase rail (see project-phases.tsx's `skipped`).
 *
 * Only touches default milestones strictly before a project's current phase.
 * Dates are spaced backward from the current phase's own planned date (or
 * today, if that is unset too) in fixed steps and are guesses, not history —
 * this writes plainly to project_milestones, not through updateMilestone, so
 * it does not trigger the live rebase-on-actual-correction logic that action
 * carries (see rebaseFromActual), which exists for a person editing a date
 * today, not for backfilling a past nobody recorded.
 *
 *   npx tsx scripts/backfill-past-phase-dates.ts
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { and, asc, eq, isNull } from "drizzle-orm";
import { db, schema } from "../src/db";
import { phaseIndex, PROJECT_PHASES } from "../src/lib/stages";
import { toIsoDate, todayInBusinessZone } from "../src/lib/schedule-defaults";

/** Calendar days back per phase step — a guess, not a measured duration. */
const STEP_DAYS = 21;
/** Actual lands a few days after planned, so the two dates aren't identical. */
const ACTUAL_OFFSET_DAYS = 3;

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toIsoDate(d);
}

async function main() {
  const d = db();
  const today = toIsoDate(todayInBusinessZone());

  const projects = await d
    .select({ id: schema.projects.id, name: schema.projects.name, phase: schema.projects.phase })
    .from(schema.projects)
    .where(isNull(schema.projects.archivedAt));

  const milestones = await d
    .select({
      id: schema.projectMilestones.id,
      projectId: schema.projectMilestones.projectId,
      phase: schema.projectMilestones.phase,
      plannedDate: schema.projectMilestones.plannedDate,
      actualDate: schema.projectMilestones.actualDate,
    })
    .from(schema.projectMilestones)
    .where(
      and(
        eq(schema.projectMilestones.isDefault, true),
        isNull(schema.projectMilestones.archivedAt),
      ),
    )
    .orderBy(asc(schema.projectMilestones.projectId));

  const byProject = new Map<number, typeof milestones>();
  for (const m of milestones) {
    (byProject.get(m.projectId) ?? byProject.set(m.projectId, []).get(m.projectId)!).push(m);
  }

  let touched = 0;
  let projectsTouched = 0;

  for (const p of projects) {
    const currentIndex = phaseIndex(p.phase);
    if (currentIndex <= 0) continue; // Pre-Construction has nothing before it.

    const rows = byProject.get(p.id) ?? [];
    const byPhase = new Map(rows.map((r) => [r.phase, r]));

    // Anchor: the current phase's own planned start, else today. Earlier
    // phases are guessed backward from here so they land before it.
    const currentRow = byPhase.get(p.phase);
    let anchor = currentRow?.plannedDate ?? today;

    const before = PROJECT_PHASES.slice(0, currentIndex);
    // Walk from the phase nearest "now" backward, so each step is relative to
    // the guess just made rather than all measured from the same anchor.
    for (let i = before.length - 1; i >= 0; i--) {
      const key = before[i].key;
      const row = byPhase.get(key);
      if (!row) continue; // No default row for this phase on this project.

      const needsPlanned = !row.plannedDate;
      const needsActual = !row.actualDate;
      if (!needsPlanned && !needsActual) {
        // Already complete — this phase's own planned date becomes the anchor
        // for whatever comes before it.
        anchor = row.plannedDate!;
        continue;
      }

      const guessedPlanned = row.plannedDate ?? addDays(anchor, -STEP_DAYS);
      const guessedActual = row.actualDate ?? addDays(guessedPlanned, ACTUAL_OFFSET_DAYS);

      const set: { plannedDate?: string; actualDate?: string } = {};
      if (needsPlanned) set.plannedDate = guessedPlanned;
      if (needsActual) set.actualDate = guessedActual;

      await d.update(schema.projectMilestones).set(set).where(eq(schema.projectMilestones.id, row.id));
      touched++;

      anchor = guessedPlanned;
    }
    projectsTouched++;
  }

  console.log(`Filled ${touched} milestone(s) across ${projectsTouched} project(s) with a past phase.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

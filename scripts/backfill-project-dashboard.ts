/**
 * Backfill for the project dashboard rebuild:
 * Seed 4 default milestones per project (one per phase) with planned dates
 * derived from existing date fields and actuals from phase events.
 *
 * Idempotent — safe to run multiple times.
 * Usage: npx tsx scripts/backfill-project-dashboard.ts
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
import { isNull, sql } from "drizzle-orm";
import { db } from "../src/db";
import * as schema from "../src/db/schema";

const DEFAULT_MILESTONES = [
  { label: "Pre-Con", phase: "precon" as const, sortOrder: 0 },
  { label: "Kickoff", phase: "in_process" as const, sortOrder: 1 },
  { label: "Punch", phase: "punch" as const, sortOrder: 2 },
  { label: "Complete", phase: "complete" as const, sortOrder: 3 },
];

async function main() {
  const d = db();

  // Seed default milestones per project
  const projects = await d
    .select({
      id: schema.projects.id,
      phase: schema.projects.phase,
      startDate: schema.projects.startDate,
      completeDate: schema.projects.completeDate,
      targetCompletionDate: schema.projects.targetCompletionDate,
      preWalkDate: schema.projects.preWalkDate,
    })
    .from(schema.projects)
    .where(isNull(schema.projects.archivedAt));

  // Get existing milestones to skip projects that already have them
  const existingMilestones = await d
    .select({ projectId: schema.projectMilestones.projectId })
    .from(schema.projectMilestones)
    .where(isNull(schema.projectMilestones.archivedAt));
  const projectsWithMilestones = new Set(existingMilestones.map((m) => m.projectId));

  // Get phase events for actual date derivation
  const phaseEvents = await d
    .select({
      projectId: schema.projectStageEvents.projectId,
      toPhase: schema.projectStageEvents.toPhase,
      createdAt: schema.projectStageEvents.createdAt,
    })
    .from(schema.projectStageEvents)
    .where(sql`${schema.projectStageEvents.toPhase} is not null`)
    .orderBy(schema.projectStageEvents.createdAt);

  // First event per (project, phase) = the actual date
  const firstEventDate = new Map<string, string>();
  for (const e of phaseEvents) {
    const key = `${e.projectId}:${e.toPhase}`;
    if (!firstEventDate.has(key)) {
      firstEventDate.set(key, new Date(e.createdAt).toLocaleDateString("en-CA"));
    }
  }

  const PHASE_ORDER = ["precon", "in_process", "punch", "complete"];

  let seeded = 0;
  for (const p of projects) {
    if (projectsWithMilestones.has(p.id)) continue;

    const phaseIdx = PHASE_ORDER.indexOf(p.phase);

    const rows = DEFAULT_MILESTONES.map((ms) => {
      const msPhaseIdx = PHASE_ORDER.indexOf(ms.phase);
      const isReached = msPhaseIdx <= phaseIdx;

      let plannedDate: string | null = null;
      if (ms.phase === "precon") plannedDate = p.preWalkDate;
      else if (ms.phase === "in_process") plannedDate = p.startDate;
      else if (ms.phase === "complete") plannedDate = p.targetCompletionDate ?? p.completeDate;

      const actualDate = isReached
        ? firstEventDate.get(`${p.id}:${ms.phase}`) ?? null
        : null;

      return {
        projectId: p.id,
        label: ms.label,
        phase: ms.phase,
        plannedDate,
        actualDate,
        sortOrder: ms.sortOrder,
      };
    });

    await d.insert(schema.projectMilestones).values(rows);
    seeded++;
  }

  console.log(`✓ Seeded default milestones for ${seeded} projects (${projects.length - seeded} already had milestones)`);
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

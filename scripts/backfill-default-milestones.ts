/**
 * Seed the four default milestones on every project that lacks them, and mark
 * the already-seeded ones as defaults so they become protected.
 *
 * Idempotent — safe to run repeatedly.
 * Usage: npx tsx scripts/backfill-default-milestones.ts
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "../src/db";
import { DEFAULT_MILESTONES, FIRST_CUSTOM_SORT_ORDER } from "../src/lib/milestones";

const PHASE_ORDER = DEFAULT_MILESTONES.map((m) => m.phase);

async function main() {
  const d = db();

  // 1. Flag existing seeded rows, matched on (label, phase) so a custom
  //    milestone that merely shares a label is not swept up.
  const flagged = await d
    .update(schema.projectMilestones)
    .set({ isDefault: true })
    .where(
      and(
        eq(schema.projectMilestones.isDefault, false),
        isNull(schema.projectMilestones.archivedAt),
        sql`(${schema.projectMilestones.label}, ${schema.projectMilestones.phase}::text) IN ${sql.raw(
          "(" + DEFAULT_MILESTONES.map((m) => `('${m.label}', '${m.phase}')`).join(", ") + ")",
        )}`,
      ),
    )
    .returning({ id: schema.projectMilestones.id });
  console.log(`flagged ${flagged.length} existing milestones as defaults`);

  // 2. Seed projects that are missing any of the four.
  const projects = await d
    .select({
      id: schema.projects.id,
      name: schema.projects.name,
      phase: schema.projects.phase,
      preWalkDate: schema.projects.preWalkDate,
      startDate: schema.projects.startDate,
      completeDate: schema.projects.completeDate,
      targetCompletionDate: schema.projects.targetCompletionDate,
    })
    .from(schema.projects)
    .where(isNull(schema.projects.archivedAt));

  const existing = await d
    .select({ projectId: schema.projectMilestones.projectId, phase: schema.projectMilestones.phase })
    .from(schema.projectMilestones)
    .where(and(isNull(schema.projectMilestones.archivedAt), eq(schema.projectMilestones.isDefault, true)));

  const havePhases = new Map<number, Set<string>>();
  for (const e of existing) {
    if (!e.phase) continue;
    (havePhases.get(e.projectId) ?? havePhases.set(e.projectId, new Set()).get(e.projectId)!).add(e.phase);
  }

  // Actual dates come from the first recorded entry into each phase.
  const events = await d
    .select({
      projectId: schema.projectStageEvents.projectId,
      toPhase: schema.projectStageEvents.toPhase,
      createdAt: schema.projectStageEvents.createdAt,
    })
    .from(schema.projectStageEvents)
    .where(sql`${schema.projectStageEvents.toPhase} is not null`)
    .orderBy(schema.projectStageEvents.createdAt);
  const firstEvent = new Map<string, string>();
  for (const e of events) {
    const k = `${e.projectId}:${e.toPhase}`;
    if (!firstEvent.has(k)) firstEvent.set(k, new Date(e.createdAt).toLocaleDateString("en-CA"));
  }

  const rows: (typeof schema.projectMilestones.$inferInsert)[] = [];
  const seededProjects: string[] = [];
  for (const p of projects) {
    const have = havePhases.get(p.id) ?? new Set<string>();
    const missing = DEFAULT_MILESTONES.filter((m) => !have.has(m.phase));
    if (missing.length === 0) continue;
    seededProjects.push(`${p.name} (${missing.length})`);

    const reachedIdx = PHASE_ORDER.indexOf(p.phase as (typeof PHASE_ORDER)[number]);
    for (const m of missing) {
      const plannedDate =
        m.phase === "precon"
          ? p.preWalkDate
          : m.phase === "in_process"
            ? p.startDate
            : m.phase === "complete"
              ? p.targetCompletionDate ?? p.completeDate
              : null;
      const reached = PHASE_ORDER.indexOf(m.phase) <= reachedIdx;
      rows.push({
        projectId: p.id,
        label: m.label,
        phase: m.phase,
        plannedDate,
        actualDate: reached ? firstEvent.get(`${p.id}:${m.phase}`) ?? null : null,
        sortOrder: m.sortOrder,
        isDefault: true,
      });
    }
  }

  if (rows.length) {
    await d.insert(schema.projectMilestones).values(rows);
  }
  console.log(`seeded ${rows.length} milestones across ${seededProjects.length} projects:`);
  for (const s of seededProjects) console.log(`  - ${s}`);

  // 3. Push pre-existing customs past the defaults so they stop colliding at 0.
  const customs = await d
    .select({ id: schema.projectMilestones.id, projectId: schema.projectMilestones.projectId })
    .from(schema.projectMilestones)
    .where(
      and(
        eq(schema.projectMilestones.isDefault, false),
        isNull(schema.projectMilestones.archivedAt),
        sql`${schema.projectMilestones.sortOrder} < ${FIRST_CUSTOM_SORT_ORDER}`,
      ),
    );
  if (customs.length) {
    await d
      .update(schema.projectMilestones)
      .set({ sortOrder: FIRST_CUSTOM_SORT_ORDER })
      .where(inArray(schema.projectMilestones.id, customs.map((c) => c.id)));
  }
  console.log(`renumbered ${customs.length} custom milestones to sort after the defaults`);

  console.log("Done.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

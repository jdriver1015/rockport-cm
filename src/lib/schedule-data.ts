import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/db";

export type ScheduleProject = {
  id: number;
  propertyId: number;
  propertySlug: string;
  propertyName: string;
  name: string;
  kind: string;
  phase: string;
  unitLabel: string | null;
  preWalkDate: string | null;
  /**
   * TARGET PHASING — the planned begin of the work and the planned finish, read
   * from the project's four seeded phase milestones.
   *
   * These used to be read from `projects.start_date` and
   * `projects.target_completion_date`, which the wizard filled at creation. That
   * put the plan in two places: editing a phase's target on the project page
   * moved one copy and left these views drawing the other. Worse,
   * `start_date` is also stamped with the REAL start on entry to In Process, so
   * a Gantt bar's left edge silently changed meaning mid-project.
   */
  targetStart: string | null;
  targetCompletion: string | null;
  /** What actually happened — stamped on entry to In Process and Complete. */
  actualStart: string | null;
  actualCompletion: string | null;
};

/**
 * Every non-archived project with at least one date on it, across the whole
 * portfolio or scoped to one property. Backs all three Schedule views
 * (Agenda/Calendar/Gantt) so they stay consistent with each other.
 */
export async function getScheduleProjects(opts?: {
  propertyId?: number;
}): Promise<ScheduleProject[]> {
  const rows = await db()
    .select({
      id: schema.projects.id,
      propertyId: schema.projects.propertyId,
      propertySlug: schema.properties.slug,
      propertyName: schema.properties.name,
      name: schema.projects.name,
      kind: schema.projects.kind,
      phase: schema.projects.phase,
      unitNumber: schema.units.unitNumber,
      preWalkDate: schema.projects.preWalkDate,
      startDate: schema.projects.startDate,
      completeDate: schema.projects.completeDate,
    })
    .from(schema.projects)
    .innerJoin(schema.properties, eq(schema.projects.propertyId, schema.properties.id))
    .leftJoin(schema.units, eq(schema.projects.unitId, schema.units.id))
    .where(
      and(
        isNull(schema.projects.archivedAt),
        opts?.propertyId != null ? eq(schema.projects.propertyId, opts.propertyId) : undefined,
      ),
    )
    .orderBy(asc(schema.properties.name), asc(schema.projects.name));

  // A second query rather than a join: one row per project stays one row, and
  // the "has any date at all" filter can then be applied over both sources
  // instead of being split across a WHERE and a HAVING.
  //
  // isDefault pins this to the four seeded phase rows. A custom milestone may
  // also carry a phase, and one tagged "In Process" would otherwise compete
  // with the real target for the same slot.
  const targets = new Map<number, { start: string | null; completion: string | null }>();
  if (rows.length > 0) {
    const milestones = await db()
      .select({
        projectId: schema.projectMilestones.projectId,
        phase: schema.projectMilestones.phase,
        plannedDate: schema.projectMilestones.plannedDate,
      })
      .from(schema.projectMilestones)
      .where(
        and(
          inArray(
            schema.projectMilestones.projectId,
            rows.map((r) => r.id),
          ),
          eq(schema.projectMilestones.isDefault, true),
          isNull(schema.projectMilestones.archivedAt),
        ),
      );

    for (const m of milestones) {
      if (m.phase !== "in_process" && m.phase !== "complete") continue;
      const entry = targets.get(m.projectId) ?? { start: null, completion: null };
      if (m.phase === "in_process") entry.start = m.plannedDate;
      else entry.completion = m.plannedDate;
      targets.set(m.projectId, entry);
    }
  }

  return rows
    .map((r) => {
      const t = targets.get(r.id);
      return {
        id: r.id,
        propertyId: r.propertyId,
        propertySlug: r.propertySlug,
        propertyName: r.propertyName,
        name: r.name,
        kind: r.kind,
        phase: r.phase,
        unitLabel: r.unitNumber ? `Unit ${r.unitNumber}` : null,
        preWalkDate: r.preWalkDate,
        targetStart: t?.start ?? null,
        targetCompletion: t?.completion ?? null,
        actualStart: r.startDate,
        actualCompletion: r.completeDate,
      };
    })
    .filter(
      (p) =>
        !!p.preWalkDate || !!p.targetStart || !!p.targetCompletion || !!p.actualStart ||
        !!p.actualCompletion,
    );
}

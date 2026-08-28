import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { PHASE_KEYS } from "@/lib/schedule-defaults";
import { readSlipTotals } from "@/lib/target-slip";
import type { ProjectPhaseKey } from "@/lib/stages";

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
  /**
   * The target start of EVERY phase, so the Gantt can draw one band per phase
   * instead of one bar per project. A bar that spans the whole job while its
   * label names only today's phase reads as though the whole span were that
   * phase; four bands say which stretch is which.
   *
   * Sparse on purpose. A phase nobody has dated is absent rather than guessed,
   * and the chart draws what is known instead of inventing a plan.
   */
  phaseTargets: Partial<Record<ProjectPhaseKey, string>>;
  /**
   * Working days this project's finish has been pushed since it was first
   * planned. Targets move on their own when a phase is missed, so without this
   * a schedule that has slipped three weeks looks identical to one that never
   * slipped at all.
   */
  slipDays: number;
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
  const targets = new Map<number, Partial<Record<ProjectPhaseKey, string>>>();
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

    const known = new Set<string>(PHASE_KEYS);
    for (const m of milestones) {
      if (!m.phase || !m.plannedDate || !known.has(m.phase)) continue;
      const entry = targets.get(m.projectId) ?? {};
      entry[m.phase as ProjectPhaseKey] = m.plannedDate;
      targets.set(m.projectId, entry);
    }
  }

  const slip = await readSlipTotals(rows.map((r) => r.id));

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
        // Kept as named fields because the agenda and calendar ask exactly these
        // two questions; the Gantt reads the full map instead.
        targetStart: t?.in_process ?? null,
        targetCompletion: t?.complete ?? null,
        actualStart: r.startDate,
        actualCompletion: r.completeDate,
        phaseTargets: t ?? {},
        slipDays: slip.get(r.id) ?? 0,
      };
    })
    .filter(
      (p) =>
        !!p.preWalkDate || !!p.targetStart || !!p.targetCompletion || !!p.actualStart ||
        !!p.actualCompletion,
    );
}

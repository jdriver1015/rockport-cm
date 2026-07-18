import { and, asc, eq, isNull, or, isNotNull } from "drizzle-orm";
import { db, schema } from "@/db";

export type ScheduleProject = {
  id: number;
  propertyId: number;
  propertyName: string;
  name: string;
  kind: string;
  stage: string;
  unitLabel: string | null;
  preWalkDate: string | null;
  startDate: string | null;
  targetCompletionDate: string | null;
  completeDate: string | null;
};

/**
 * Every non-archived project with at least one milestone date set, across the
 * whole portfolio or scoped to one property. Backs all three Schedule views
 * (Agenda/Calendar/Gantt) so they stay consistent with each other.
 */
export async function getScheduleProjects(opts?: {
  propertyId?: number;
}): Promise<ScheduleProject[]> {
  const rows = await db()
    .select({
      id: schema.projects.id,
      propertyId: schema.projects.propertyId,
      propertyName: schema.properties.name,
      name: schema.projects.name,
      kind: schema.projects.kind,
      stage: schema.projects.stage,
      unitNumber: schema.units.unitNumber,
      preWalkDate: schema.projects.preWalkDate,
      startDate: schema.projects.startDate,
      targetCompletionDate: schema.projects.targetCompletionDate,
      completeDate: schema.projects.completeDate,
    })
    .from(schema.projects)
    .innerJoin(schema.properties, eq(schema.projects.propertyId, schema.properties.id))
    .leftJoin(schema.units, eq(schema.projects.unitId, schema.units.id))
    .where(
      and(
        isNull(schema.projects.archivedAt),
        opts?.propertyId != null ? eq(schema.projects.propertyId, opts.propertyId) : undefined,
        or(
          isNotNull(schema.projects.preWalkDate),
          isNotNull(schema.projects.startDate),
          isNotNull(schema.projects.targetCompletionDate),
          isNotNull(schema.projects.completeDate),
        ),
      ),
    )
    .orderBy(asc(schema.properties.name), asc(schema.projects.name));

  return rows.map((r) => ({
    id: r.id,
    propertyId: r.propertyId,
    propertyName: r.propertyName,
    name: r.name,
    kind: r.kind,
    stage: r.stage,
    unitLabel: r.unitNumber ? `Unit ${r.unitNumber}` : null,
    preWalkDate: r.preWalkDate,
    startDate: r.startDate,
    targetCompletionDate: r.targetCompletionDate,
    completeDate: r.completeDate,
  }));
}

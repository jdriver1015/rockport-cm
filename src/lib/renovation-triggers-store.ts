import { asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import type { TriggerAnswer, TriggerCondition, TriggerMode, TriggerStep } from "@/lib/renovation-triggers";

// ---------------------------------------------------------------------------
// Queries behind the trigger rule. Server-only: importing this from a client
// component would pull the database client into the browser bundle.
// ---------------------------------------------------------------------------
/** One property's trigger steps, in order, each with its conditions. */
export async function listTriggerSteps(propertyId: number): Promise<TriggerStep[]> {
  const steps = await db()
    .select({
      id: schema.renovationTriggerSteps.id,
      mode: schema.renovationTriggerSteps.mode,
      sortOrder: schema.renovationTriggerSteps.sortOrder,
      budgetGroupId: schema.renovationTriggerSteps.budgetGroupId,
      typeName: schema.budgetGroups.name,
    })
    .from(schema.renovationTriggerSteps)
    .leftJoin(
      schema.budgetGroups,
      eq(schema.budgetGroups.id, schema.renovationTriggerSteps.budgetGroupId),
    )
    .where(eq(schema.renovationTriggerSteps.propertyId, propertyId))
    .orderBy(asc(schema.renovationTriggerSteps.sortOrder), asc(schema.renovationTriggerSteps.id));

  if (steps.length === 0) return [];

  const conditions = await db()
    .select({
      id: schema.renovationTriggerConditions.id,
      stepId: schema.renovationTriggerConditions.stepId,
      text: schema.renovationTriggerConditions.text,
      sortOrder: schema.renovationTriggerConditions.sortOrder,
    })
    .from(schema.renovationTriggerConditions)
    .where(
      inArray(
        schema.renovationTriggerConditions.stepId,
        steps.map((s) => s.id),
      ),
    )
    .orderBy(
      asc(schema.renovationTriggerConditions.sortOrder),
      asc(schema.renovationTriggerConditions.id),
    );

  const byStep = new Map<number, TriggerCondition[]>();
  for (const c of conditions) {
    const list = byStep.get(c.stepId) ?? [];
    list.push({ id: c.id, text: c.text, sortOrder: c.sortOrder });
    byStep.set(c.stepId, list);
  }

  return steps.map((s) => ({
    id: s.id,
    mode: s.mode as TriggerMode,
    sortOrder: s.sortOrder,
    budgetGroupId: s.budgetGroupId,
    typeName: s.typeName,
    conditions: byStep.get(s.id) ?? [],
  }));
}

/**
 * What was recorded on one unit.
 *
 * Reads conditionText from the answer, never by joining back to the live
 * condition: the point of the snapshot is that this stays true after the rule is
 * edited.
 */
export async function listTriggerAnswers(projectId: number): Promise<TriggerAnswer[]> {
  const rows = await db()
    .select({
      conditionId: schema.projectTriggerAnswers.conditionId,
      conditionText: schema.projectTriggerAnswers.conditionText,
      checked: schema.projectTriggerAnswers.checked,
      recordedAt: schema.projectTriggerAnswers.recordedAt,
      recordedByName: schema.profiles.fullName,
    })
    .from(schema.projectTriggerAnswers)
    .leftJoin(schema.profiles, eq(schema.profiles.id, schema.projectTriggerAnswers.recordedBy))
    .where(eq(schema.projectTriggerAnswers.projectId, projectId))
    .orderBy(asc(schema.projectTriggerAnswers.id));

  return rows.map((r) => ({
    conditionId: r.conditionId,
    conditionText: r.conditionText,
    checked: r.checked,
    recordedAt: r.recordedAt,
    recordedByName: r.recordedByName ?? null,
  }));
}


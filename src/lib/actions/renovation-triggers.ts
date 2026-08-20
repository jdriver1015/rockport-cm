"use server";

import { revalidatePath } from "next/cache";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import type { ActionResult } from "@/lib/action-result";
import { createClient } from "@/lib/supabase/server";
import { propertyPath } from "@/lib/property-path";
import { TRIGGER_MODES } from "@/lib/renovation-triggers";

// ---------------------------------------------------------------------------
// Editing a property's trigger rule, and recording what a walker answered on a
// unit.
// ---------------------------------------------------------------------------

async function revalidateProperty(propertyId: number) {
  const path = await propertyPath(propertyId, "/interiors/triggers");
  if (path) revalidatePath(path);
}

const addStepSchema = z.object({
  propertyId: z.coerce.number().int().positive(),
  budgetGroupId: z.coerce.number().int().positive(),
  mode: z.enum(TRIGGER_MODES).default("any"),
});

/** Add a step to the end of the rule. */
export async function addTriggerStep(
  input: z.input<typeof addStepSchema>,
): Promise<ActionResult<{ stepId: number }>> {
  const parsed = addStepSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { propertyId, budgetGroupId, mode } = parsed.data;

  // The type has to belong to this property, or one property's rule could assign
  // another's renovation type.
  const group = await db().query.budgetGroups.findFirst({
    where: eq(schema.budgetGroups.id, budgetGroupId),
    columns: { propertyId: true },
  });
  if (!group || group.propertyId !== propertyId) {
    return { ok: false, error: "That renovation type isn't on this property" };
  }

  const [{ maxOrder }] = await db()
    .select({
      maxOrder: sql<number>`coalesce(max(${schema.renovationTriggerSteps.sortOrder}), -1)::int`,
    })
    .from(schema.renovationTriggerSteps)
    .where(eq(schema.renovationTriggerSteps.propertyId, propertyId));

  const [step] = await db()
    .insert(schema.renovationTriggerSteps)
    .values({ propertyId, budgetGroupId, mode, sortOrder: maxOrder + 1 })
    .returning({ id: schema.renovationTriggerSteps.id });

  await revalidateProperty(propertyId);
  return { ok: true, stepId: step.id };
}

const updateStepSchema = z.object({
  propertyId: z.coerce.number().int().positive(),
  stepId: z.coerce.number().int().positive(),
  budgetGroupId: z.coerce.number().int().positive().optional(),
  mode: z.enum(TRIGGER_MODES).optional(),
});

/** Change which type a step assigns, or how its conditions combine. */
export async function updateTriggerStep(
  input: z.input<typeof updateStepSchema>,
): Promise<ActionResult> {
  const parsed = updateStepSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { propertyId, stepId, budgetGroupId, mode } = parsed.data;

  if (budgetGroupId != null) {
    const group = await db().query.budgetGroups.findFirst({
      where: eq(schema.budgetGroups.id, budgetGroupId),
      columns: { propertyId: true },
    });
    if (!group || group.propertyId !== propertyId) {
      return { ok: false, error: "That renovation type isn't on this property" };
    }
  }

  const [row] = await db()
    .update(schema.renovationTriggerSteps)
    .set({
      ...(budgetGroupId != null ? { budgetGroupId } : {}),
      ...(mode != null ? { mode } : {}),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.renovationTriggerSteps.id, stepId),
        eq(schema.renovationTriggerSteps.propertyId, propertyId),
      ),
    )
    .returning({ id: schema.renovationTriggerSteps.id });
  if (!row) return { ok: false, error: "That step no longer exists" };

  await revalidateProperty(propertyId);
  return { ok: true };
}

const removeStepSchema = z.object({
  propertyId: z.coerce.number().int().positive(),
  stepId: z.coerce.number().int().positive(),
});

/** Remove a step and its conditions. Recorded answers keep their wording. */
export async function removeTriggerStep(
  input: z.input<typeof removeStepSchema>,
): Promise<ActionResult> {
  const parsed = removeStepSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const [row] = await db()
    .delete(schema.renovationTriggerSteps)
    .where(
      and(
        eq(schema.renovationTriggerSteps.id, parsed.data.stepId),
        eq(schema.renovationTriggerSteps.propertyId, parsed.data.propertyId),
      ),
    )
    .returning({ id: schema.renovationTriggerSteps.id });
  if (!row) return { ok: false, error: "That step no longer exists" };

  await revalidateProperty(parsed.data.propertyId);
  return { ok: true };
}

const moveStepSchema = z.object({
  propertyId: z.coerce.number().int().positive(),
  stepId: z.coerce.number().int().positive(),
  direction: z.enum(["up", "down"]),
});

/**
 * Reorder a step by swapping it with its neighbour.
 *
 * Order is the rule: the first step whose condition is met wins, so moving a
 * step changes which type a unit gets. Swapping keeps the sequence dense and
 * needs no renumbering pass.
 */
export async function moveTriggerStep(
  input: z.input<typeof moveStepSchema>,
): Promise<ActionResult> {
  const parsed = moveStepSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { propertyId, stepId, direction } = parsed.data;

  const steps = await db()
    .select({
      id: schema.renovationTriggerSteps.id,
      sortOrder: schema.renovationTriggerSteps.sortOrder,
    })
    .from(schema.renovationTriggerSteps)
    .where(eq(schema.renovationTriggerSteps.propertyId, propertyId))
    .orderBy(asc(schema.renovationTriggerSteps.sortOrder), asc(schema.renovationTriggerSteps.id));

  const index = steps.findIndex((s) => s.id === stepId);
  if (index === -1) return { ok: false, error: "That step no longer exists" };
  const swapWith = direction === "up" ? index - 1 : index + 1;
  if (swapWith < 0 || swapWith >= steps.length) return { ok: true };

  // Written as positions, not the stored sortOrder values, so a rule whose
  // numbering has gaps or ties still ends up in the intended order.
  const reordered = [...steps];
  [reordered[index], reordered[swapWith]] = [reordered[swapWith], reordered[index]];
  for (const [i, s] of reordered.entries()) {
    await db()
      .update(schema.renovationTriggerSteps)
      .set({ sortOrder: i, updatedAt: new Date() })
      .where(eq(schema.renovationTriggerSteps.id, s.id));
  }

  await revalidateProperty(propertyId);
  return { ok: true };
}

const addConditionSchema = z.object({
  propertyId: z.coerce.number().int().positive(),
  stepId: z.coerce.number().int().positive(),
  text: z.string().trim().min(1, "Describe the condition").max(300),
});

/** Add a condition to a step. */
export async function addTriggerCondition(
  input: z.input<typeof addConditionSchema>,
): Promise<ActionResult> {
  const parsed = addConditionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { propertyId, stepId, text } = parsed.data;

  const step = await db().query.renovationTriggerSteps.findFirst({
    where: eq(schema.renovationTriggerSteps.id, stepId),
    columns: { propertyId: true },
  });
  if (!step || step.propertyId !== propertyId) {
    return { ok: false, error: "That step no longer exists" };
  }

  const [{ maxOrder }] = await db()
    .select({
      maxOrder: sql<number>`coalesce(max(${schema.renovationTriggerConditions.sortOrder}), -1)::int`,
    })
    .from(schema.renovationTriggerConditions)
    .where(eq(schema.renovationTriggerConditions.stepId, stepId));

  await db()
    .insert(schema.renovationTriggerConditions)
    .values({ stepId, text, sortOrder: maxOrder + 1 });

  await revalidateProperty(propertyId);
  return { ok: true };
}

const removeConditionSchema = z.object({
  propertyId: z.coerce.number().int().positive(),
  conditionId: z.coerce.number().int().positive(),
});

/**
 * Remove a condition from the rule.
 *
 * Answers already recorded against it are kept — the FK is SET NULL and the
 * wording is snapshotted on the answer, so a unit walked last month still shows
 * why it got its type.
 */
export async function removeTriggerCondition(
  input: z.input<typeof removeConditionSchema>,
): Promise<ActionResult> {
  const parsed = removeConditionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { propertyId, conditionId } = parsed.data;

  const rows = await db()
    .select({ propertyId: schema.renovationTriggerSteps.propertyId })
    .from(schema.renovationTriggerConditions)
    .innerJoin(
      schema.renovationTriggerSteps,
      eq(schema.renovationTriggerSteps.id, schema.renovationTriggerConditions.stepId),
    )
    .where(eq(schema.renovationTriggerConditions.id, conditionId));
  if (rows.length === 0 || rows[0].propertyId !== propertyId) {
    return { ok: false, error: "That condition no longer exists" };
  }

  await db()
    .delete(schema.renovationTriggerConditions)
    .where(eq(schema.renovationTriggerConditions.id, conditionId));

  await revalidateProperty(propertyId);
  return { ok: true };
}

const recordSchema = z.object({
  projectId: z.coerce.number().int().positive(),
  propertyId: z.coerce.number().int().positive(),
  checkedConditionIds: z.array(z.coerce.number().int().positive()).max(200),
});

/**
 * Record what the walker answered on one unit.
 *
 * Writes a row per condition on the property's rule, checked or not, with the
 * condition's wording snapshotted. An unchecked condition is recorded
 * deliberately: "we looked and it did not apply" is different from "we never
 * asked", and only the first justifies the type that was assigned.
 */
export async function recordTriggerAnswers(
  input: z.input<typeof recordSchema>,
): Promise<ActionResult<{ recorded: number }>> {
  const parsed = recordSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { projectId, propertyId, checkedConditionIds } = parsed.data;

  const project = await db().query.projects.findFirst({
    where: eq(schema.projects.id, projectId),
    columns: { propertyId: true },
  });
  if (!project || project.propertyId !== propertyId) {
    return { ok: false, error: "That unit isn't on this property" };
  }

  const conditions = await db()
    .select({
      id: schema.renovationTriggerConditions.id,
      text: schema.renovationTriggerConditions.text,
    })
    .from(schema.renovationTriggerConditions)
    .innerJoin(
      schema.renovationTriggerSteps,
      eq(schema.renovationTriggerSteps.id, schema.renovationTriggerConditions.stepId),
    )
    .where(eq(schema.renovationTriggerSteps.propertyId, propertyId));
  if (conditions.length === 0) {
    return { ok: false, error: "This property has no trigger conditions to answer yet" };
  }

  // A checked id that isn't on this property's rule means the form was built
  // against a rule that has since changed.
  const valid = new Set(conditions.map((c) => c.id));
  if (checkedConditionIds.some((id) => !valid.has(id))) {
    return { ok: false, error: "The rule changed while you were answering — reload and try again" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const checked = new Set(checkedConditionIds);

  // Replace this unit's answers wholesale rather than upserting each: a re-walk
  // is a fresh answer set, and a condition removed from the rule since the last
  // walk should not linger as an answer to a question no longer asked.
  await db()
    .delete(schema.projectTriggerAnswers)
    .where(
      and(
        eq(schema.projectTriggerAnswers.projectId, projectId),
        inArray(
          schema.projectTriggerAnswers.conditionId,
          conditions.map((c) => c.id),
        ),
      ),
    );

  await db()
    .insert(schema.projectTriggerAnswers)
    .values(
      conditions.map((c) => ({
        projectId,
        conditionId: c.id,
        conditionText: c.text,
        checked: checked.has(c.id),
        recordedBy: user?.id ?? null,
      })),
    );

  const path = await propertyPath(propertyId, `/projects/${projectId}`);
  if (path) revalidatePath(path);
  return { ok: true, recorded: conditions.length };
}

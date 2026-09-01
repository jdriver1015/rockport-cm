"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import type { ActionResult } from "@/lib/action-result";
import { PRICING_METHODS } from "@/lib/pricing";
import { propertyPath } from "@/lib/property-path";
import { recomputeProjectBudget } from "@/lib/project-budget-derive";
import { defaultMilestoneRows } from "@/lib/milestones";
import { projectSlug } from "@/lib/slug";

// ---------------------------------------------------------------------------
// Interior project creation — the wizard's final step. Snapshots the reviewed,
// priced budget lines onto a new kind='unit' project and seeds its budgetAmount
// from their sum. Line totals stay derived (quantity × unitPrice).
// ---------------------------------------------------------------------------

const lineSchema = z.object({
  item: z.string().trim().min(1),
  category: z.string().trim().optional().nullable(),
  pricingMethod: z.enum(PRICING_METHODS),
  unitPrice: z.coerce.number().nonnegative(),
  quantity: z.coerce.number(),
  costCodeId: z.coerce.number().int().positive(),
  sourceBudgetLineId: z.coerce.number().int().positive().optional().nullable(),
  notes: z.string().trim().optional().nullable(),
});

/**
 * Postgres 23505. The pre-check in createInteriorProject narrows the
 * double-submit window; the partial unique index closes it, and the transaction
 * that loses the race surfaces here.
 *
 * Walks the cause chain rather than reading `err.code`: Drizzle wraps driver
 * errors in a DrizzleQueryError and hangs the real one off `cause`, so the
 * top-level code is undefined and a check on it silently never matched —
 * turning a handled conflict back into a 500.
 */
function isUniqueViolation(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e != null && depth < 5; depth++) {
    if (typeof e === "object" && "code" in e && (e as { code?: unknown }).code === "23505") {
      return true;
    }
    e = typeof e === "object" && "cause" in e ? (e as { cause?: unknown }).cause : null;
  }
  return false;
}

const optDate = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : null));

const createSchema = z.object({
  propertyId: z.coerce.number().int().positive(),
  budgetGroupId: z.coerce.number().int().positive(),
  unitNumber: z.string().trim().min(1, "Select a unit"),
  floorplan: z.string().trim().optional().nullable(),
  bedrooms: z.coerce.number().int().nonnegative().optional().nullable(),
  baths: z.coerce.number().nonnegative().optional().nullable(),
  sqft: z.coerce.number().int().nonnegative().optional().nullable(),
  name: z.string().trim().optional(),
  preWalkDate: optDate,
  /**
   * TARGET PHASING — the day each of the four phases is planned to BEGIN, keyed
   * by phase. A phase runs until the day before the next begins, so these are
   * the whole plan; nothing here writes a start or completion date onto the
   * project, because those columns record what actually happened.
   *
   * Optional so an older caller still creates a project with undated milestones
   * rather than none.
   */
  milestones: z
    .array(z.object({ phase: z.string().trim().min(1), plannedDate: optDate }))
    .optional(),
  /**
   * Pre-walk conditions the walker ticked in the wizard, so "why this type?" has
   * an answer later. Ids not on this property's rule are ignored rather than
   * refused: the checklist is a reminder, and a stale tab should not block
   * creating the project.
   */
  checkedConditionIds: z.array(z.coerce.number().int().positive()).max(200).optional(),
  lines: z.array(lineSchema).min(1, "Add at least one budget line"),
});

export async function createInteriorProject(
  input: z.input<typeof createSchema>,
): Promise<ActionResult<{ projectId: number; slug: string }>> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const d = parsed.data;

  const property = await db().query.properties.findFirst({
    where: eq(schema.properties.id, d.propertyId),
    columns: { id: true, chartOfAccountsId: true },
  });
  if (!property) return { ok: false, error: "Property not found" };

  const group = await db().query.budgetGroups.findFirst({
    where: eq(schema.budgetGroups.id, d.budgetGroupId),
  });
  if (!group || group.propertyId !== d.propertyId) {
    return { ok: false, error: "Budget group not found for this property" };
  }

  const codeIds = [...new Set(d.lines.map((l) => l.costCodeId))];
  if (codeIds.length > 0) {
    const valid = await db()
      .select({ id: schema.costCodes.id })
      .from(schema.costCodes)
      .where(and(eq(schema.costCodes.chartId, property.chartOfAccountsId), inArray(schema.costCodes.id, codeIds)));
    if (valid.length !== codeIds.length) {
      return { ok: false, error: "A budget line references a code outside this property's chart" };
    }
  }

  // Wrapped because the pre-check inside is check-then-insert: under READ
  // COMMITTED two concurrent submits both see no clash, and the loser trips the
  // partial unique index instead. Same expected answer either way.
  let result;
  try {
    result = await db().transaction(async (tx) => {
      const existing = await tx.query.units.findFirst({
        where: and(eq(schema.units.propertyId, d.propertyId), eq(schema.units.unitNumber, d.unitNumber)),
      });
      // A unit can only be turned once. The wizard already shows claimed units as
      // unavailable, but that is an affordance, not a guarantee: a stale tab or a
      // double submit would otherwise create a second project and double-count the
      // unit in the interior budget.
      if (existing) {
        const clash = await tx
          .select({ id: schema.projects.id, name: schema.projects.name })
          .from(schema.projects)
          .where(
            and(
              eq(schema.projects.unitId, existing.id),
              eq(schema.projects.kind, "unit"),
              isNull(schema.projects.archivedAt),
            ),
          )
          .limit(1);
        if (clash.length > 0) {
          return {
            ok: false as const,
            error: `Unit ${d.unitNumber} already has an interior project ("${clash[0].name}"). Archive it first, or pick another unit.`,
          };
        }
      }

      const meta = {
        floorplan: d.floorplan ?? undefined,
        bedrooms: d.bedrooms ?? undefined,
        baths: d.baths != null ? d.baths.toFixed(1) : undefined,
        sqft: d.sqft ?? undefined,
      };
      let unitId: number;
      if (existing) {
        unitId = existing.id;
        await tx.update(schema.units).set(meta).where(eq(schema.units.id, existing.id));
      } else {
        const [unit] = await tx
          .insert(schema.units)
          .values({ propertyId: d.propertyId, unitNumber: d.unitNumber, ...meta })
          .returning({ id: schema.units.id });
        unitId = unit.id;
      }

      // Ensure this floorplan has a column for this tier in the interior budget
      // pivot before the project that spends against it exists — otherwise the
      // scope lines seeded below price out fine on the project itself but the
      // pivot (computeInteriorBudget) only shows a (unit group, tier) cell when
      // an interiorBudgetPlan row exists for it, so the spend would be real but
      // invisible everywhere else, discoverable only by noticing the Interior
      // Budget tab stayed empty. Mirrors addUnitRenovation's group-creation
      // (src/lib/actions/interior-budget-plan.ts), using the wizard's own
      // floorplan/bedrooms/baths instead of a rent-roll lookup since they're
      // already at hand.
      if (d.floorplan) {
        const [floorplanMap] = await tx
          .select({ unitGroupId: schema.interiorUnitGroupFloorplans.unitGroupId })
          .from(schema.interiorUnitGroupFloorplans)
          .where(
            and(
              eq(schema.interiorUnitGroupFloorplans.propertyId, d.propertyId),
              eq(schema.interiorUnitGroupFloorplans.floorPlanCode, d.floorplan),
            ),
          );

        let unitGroupId = floorplanMap?.unitGroupId;
        if (!unitGroupId) {
          const [{ maxOrder }] = await tx
            .select({
              maxOrder: sql<number>`coalesce(max(${schema.interiorUnitGroups.sortOrder}), -1)::int`,
            })
            .from(schema.interiorUnitGroups)
            .where(eq(schema.interiorUnitGroups.propertyId, d.propertyId));

          const [group] = await tx
            .insert(schema.interiorUnitGroups)
            .values({
              propertyId: d.propertyId,
              name: d.floorplan,
              bedrooms: d.bedrooms ?? null,
              baths: d.baths != null ? d.baths.toFixed(1) : null,
              sortOrder: maxOrder + 1,
            })
            .returning({ id: schema.interiorUnitGroups.id });
          unitGroupId = group.id;

          await tx.insert(schema.interiorUnitGroupFloorplans).values({
            propertyId: d.propertyId,
            unitGroupId,
            floorPlanCode: d.floorplan,
          });
        }

        // Widen the plan to cover this unit rather than assuming it's the first
        // — a floorplan can already have some units planned into this same tier
        // from an earlier turn, and plannedUnits tracks "committed to this tier",
        // not something a second turn should shrink back down.
        await tx
          .insert(schema.interiorBudgetPlan)
          .values({
            propertyId: d.propertyId,
            unitGroupId,
            budgetGroupId: d.budgetGroupId,
            plannedUnits: 1,
          })
          .onConflictDoUpdate({
            target: [schema.interiorBudgetPlan.unitGroupId, schema.interiorBudgetPlan.budgetGroupId],
            set: { plannedUnits: sql`${schema.interiorBudgetPlan.plannedUnits} + 1` },
          });
      }

      const projectName = d.name?.trim() || `Unit ${d.unitNumber} Interior`;
      const [project] = await tx
        .insert(schema.projects)
        .values({
          propertyId: d.propertyId,
          kind: "unit",
          name: projectName,
          unitId,
          // No vendorId. A project's vendor is whoever holds an approved bid on
          // it — see syncProjectVendor — so setting one at creation asserts an
          // award that does not exist, and the bidding flow would overwrite it.
          budgetGroupId: d.budgetGroupId,
          // No budgetAmount here: it is derived from the scope lines seeded
          // below, so writing it as well would be a second answer that only
          // agrees until somebody edits a line.
          preWalkDate: d.preWalkDate,
          // startDate and completeDate stay null: they are stamped when the
          // project really enters In Process and Complete. Seeding them with the
          // plan made one column mean "target" until the phase flipped and
          // "actual" afterwards, which the Gantt drew as a moving start.
        })
        .returning({ id: schema.projects.id });

      if (d.lines.length > 0) {
        await tx.insert(schema.scopeItems).values(
          d.lines.map((l, i) => ({
            projectId: project.id,
            item: l.item,
            materialQuality: l.notes ?? null,
            category: l.category ?? null,
            costCodeId: l.costCodeId,
            pricingMethod: l.pricingMethod,
            unitPrice: l.unitPrice.toFixed(2),
            quantity: l.quantity.toFixed(2),
            sourceBudgetLineId: l.sourceBudgetLineId ?? null,
            sortOrder: i,
          })),
        );
      }

      await tx.insert(schema.projectStageEvents).values({
        projectId: project.id,
        toStage: "planned",
        toPhase: "precon",
        note: `Created from budget group "${group.name}"`,
      });

      // Unit turns run the same four phases as common-area work, so they get the
      // same seeded milestones.
      // Planned dates come from the wizard's schedule step; a phase the caller
      // didn't send stays undated rather than guessing here, so the suggestion
      // lives in exactly one place.
      const plannedByPhase = new Map(
        (d.milestones ?? []).map((m) => [m.phase, m.plannedDate]),
      );
      await tx.insert(schema.projectMilestones).values(
        defaultMilestoneRows(project.id).map((row) => ({
          ...row,
          plannedDate: plannedByPhase.get(row.phase) ?? null,
        })),
      );

      // Pre-walk answers, recorded against every condition on the rule — the
      // unchecked ones too, because "we looked and it did not apply" is a
      // different fact from "we never asked".
      // Present-but-empty is meaningful: the walker saw the checklist and ticked
      // nothing. Absent means the caller never showed one.
      if (d.checkedConditionIds) {
        const conditions = await tx
          .select({
            id: schema.renovationTriggerConditions.id,
            text: schema.renovationTriggerConditions.text,
          })
          .from(schema.renovationTriggerConditions)
          .innerJoin(
            schema.renovationTriggerSteps,
            eq(schema.renovationTriggerSteps.id, schema.renovationTriggerConditions.stepId),
          )
          .where(eq(schema.renovationTriggerSteps.propertyId, d.propertyId));
        if (conditions.length > 0) {
          const ticked = new Set(d.checkedConditionIds);
          await tx.insert(schema.projectTriggerAnswers).values(
            conditions.map((c) => ({
              projectId: project.id,
              conditionId: c.id,
              conditionText: c.text,
              checked: ticked.has(c.id),
            })),
          );
        }
      }

      return { ok: true as const, projectId: project.id, projectName };
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return {
        ok: false,
        error: `Unit ${d.unitNumber} already has an interior project. Archive it first, or pick another unit.`,
      };
    }
    throw err;
  }

  // Refused inside the transaction, so nothing was written. Returned as a value
  // rather than thrown — a taken unit is an expected answer, not a fault.
  if (!result.ok) return result;

  // The seeded scope lines decide the budget, so it is read back off them once
  // they are committed rather than written alongside them.
  await recomputeProjectBudget(result.projectId);

  const base = await propertyPath(d.propertyId);
  if (base) {
    revalidatePath(`${base}/interiors`);
    revalidatePath(base);
    revalidatePath(`${base}/budget`);
  }
  return {
    ok: true,
    projectId: result.projectId,
    slug: projectSlug({ id: result.projectId, name: result.projectName }),
  };
}

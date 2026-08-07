"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import type { ActionResult } from "@/lib/action-result";
import { computeInteriorBudgetFor, loadFloorplanFacts } from "@/lib/interior-budget";
import { propertyPath } from "@/lib/property-path";

// ---------------------------------------------------------------------------
// The interior budget plan: how many units of each group get each upgrade tier,
// custom cell overrides, and the property's uplift rates.
// ---------------------------------------------------------------------------

async function revalidateBudget(propertyId: number) {
  const path = await propertyPath(propertyId, "/budget");
  if (path) revalidatePath(path);
}

/** Confirm a unit group and a tier both belong to the property being edited. */
async function assertOwnership(
  propertyId: number,
  unitGroupId: number,
  budgetGroupId: number,
): Promise<string | null> {
  const [group, tier] = await Promise.all([
    db().query.interiorUnitGroups.findFirst({
      where: eq(schema.interiorUnitGroups.id, unitGroupId),
      columns: { propertyId: true },
    }),
    db().query.budgetGroups.findFirst({
      where: eq(schema.budgetGroups.id, budgetGroupId),
      columns: { propertyId: true },
    }),
  ]);
  if (!group || group.propertyId !== propertyId) return "Unit group not found for this property";
  if (!tier || tier.propertyId !== propertyId) return "Upgrade tier not found for this property";
  return null;
}

/**
 * A floorplan's renovation capacity: how many units it has, how many its OTHER
 * renovation types already claim, and what this cell currently holds.
 *
 * Checking a cell against the floorplan's unit count alone is not enough — 30
 * units of Enhanced and 30 of Blended UW on a 49-unit floorplan are each legal
 * and jointly impossible. Unit counts are derived from the rent roll, so this
 * reads through the sanctioned compute path.
 */
async function capacityFor(propertyId: number, unitGroupId: number, budgetGroupId: number) {
  const budget = await computeInteriorBudgetFor(propertyId);
  const group = budget.unitGroups.find((g) => g.id === unitGroupId);
  if (!group) return null;
  return {
    unitCount: group.unitCount,
    plannedElsewhere: budget.columns
      .filter((c) => c.unitGroupId === unitGroupId && c.tierId !== budgetGroupId)
      .reduce((s, c) => s + c.plannedUnits, 0),
    stored:
      budget.columns.find((c) => c.unitGroupId === unitGroupId && c.tierId === budgetGroupId)
        ?.plannedUnits ?? 0,
  };
}

const planSchema = z.object({
  propertyId: z.coerce.number().int().positive(),
  unitGroupId: z.coerce.number().int().positive(),
  budgetGroupId: z.coerce.number().int().positive(),
  /**
   * A whole count — penetration is derived from this for display, never entered.
   */
  plannedUnits: z.coerce
    .number()
    .int("Planned units must be a whole number")
    .nonnegative("Planned units can't be negative"),
  note: z.string().trim().optional().nullable(),
});

/**
 * Offer a tier to a unit group at a given volume. Writing 0 keeps the column
 * visible with nothing planned (their Signature column is an explicit zero);
 * removing the row entirely means the tier isn't offered to that group at all.
 */
export async function upsertPlanCell(
  input: z.input<typeof planSchema>,
): Promise<ActionResult> {
  const parsed = planSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const d = parsed.data;

  const bad = await assertOwnership(d.propertyId, d.unitGroupId, d.budgetGroupId);
  if (bad) return { ok: false, error: bad };

  // A unit count of 0 means there's no rent-roll basis to check against
  // (pre-acquisition underwriting), so capacity isn't enforced there. Only an
  // INCREASE past capacity is refused, so a cell left over-allocated by a
  // shrinking rent roll can always be edited back down.
  const cap = await capacityFor(d.propertyId, d.unitGroupId, d.budgetGroupId);
  if (cap && cap.unitCount > 0 && d.plannedUnits > cap.stored) {
    const remaining = cap.unitCount - cap.plannedElsewhere;
    if (d.plannedUnits > remaining) {
      return {
        ok: false,
        error:
          remaining <= 0
            ? `All ${cap.unitCount} units of this floorplan are already planned into other renovation types.`
            : `Only ${remaining} of this floorplan's ${cap.unitCount} units are unplanned — ${cap.plannedElsewhere} are in other renovation types.`,
      };
    }
  }

  await db()
    .insert(schema.interiorBudgetPlan)
    .values({
      propertyId: d.propertyId,
      unitGroupId: d.unitGroupId,
      budgetGroupId: d.budgetGroupId,
      plannedUnits: d.plannedUnits,
      note: d.note ?? null,
    })
    .onConflictDoUpdate({
      target: [schema.interiorBudgetPlan.unitGroupId, schema.interiorBudgetPlan.budgetGroupId],
      set: { plannedUnits: d.plannedUnits, note: d.note ?? null },
    });

  await revalidateBudget(d.propertyId);
  return { ok: true };
}

const addRenovationSchema = z.object({
  propertyId: z.coerce.number().int().positive(),
  floorPlanCode: z.string(),
  budgetGroupId: z.coerce.number().int().positive(),
  units: z.coerce
    .number()
    .int("Units must be a whole number")
    .positive("Plan at least one unit"),
});

/**
 * Add one floorplan × renovation type to the budget, creating the column.
 *
 * Floorplans become columns ON DEMAND through here. Seeding every floorplan up
 * front produced 20+ columns at a real property, most of them plans the asset
 * manager never intended to touch (the already-upgraded ones), so the unit group
 * is created the first time a floorplan is actually planned.
 */
export async function addUnitRenovation(
  input: z.input<typeof addRenovationSchema>,
): Promise<ActionResult<{ unitGroupId: number }>> {
  const parsed = addRenovationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const d = parsed.data;

  const tier = await db().query.budgetGroups.findFirst({
    where: eq(schema.budgetGroups.id, d.budgetGroupId),
    columns: { propertyId: true },
  });
  if (!tier || tier.propertyId !== d.propertyId) {
    return { ok: false, error: "Renovation type not found for this property" };
  }

  const facts = await loadFloorplanFacts(d.propertyId);
  const fact = facts.find((f) => f.floorPlanCode === d.floorPlanCode);
  if (!fact) {
    return { ok: false, error: "That floorplan isn't on the latest committed rent roll." };
  }

  // The floorplan may already be a column under a DIFFERENT renovation type, in
  // which case the group exists and its remaining capacity is what's left after
  // those. A brand-new group has the whole floorplan available.
  const [existing] = await db()
    .select({ unitGroupId: schema.interiorUnitGroupFloorplans.unitGroupId })
    .from(schema.interiorUnitGroupFloorplans)
    .where(
      and(
        eq(schema.interiorUnitGroupFloorplans.propertyId, d.propertyId),
        eq(schema.interiorUnitGroupFloorplans.floorPlanCode, d.floorPlanCode),
      ),
    );

  let remaining = fact.count;
  if (existing) {
    const cap = await capacityFor(d.propertyId, existing.unitGroupId, d.budgetGroupId);
    if (cap && cap.unitCount > 0) remaining = cap.unitCount - cap.plannedElsewhere;
  }
  if (d.units > remaining) {
    return {
      ok: false,
      error:
        remaining <= 0
          ? `Every unit of ${d.floorPlanCode || "this floorplan"} is already planned into another renovation type.`
          : `Only ${remaining} unit${remaining === 1 ? "" : "s"} of ${d.floorPlanCode || "this floorplan"} are unplanned.`,
    };
  }

  const [batch] = await db()
    .select({ id: schema.rentRollBatches.id })
    .from(schema.rentRollBatches)
    .where(
      and(
        eq(schema.rentRollBatches.propertyId, d.propertyId),
        eq(schema.rentRollBatches.status, "committed"),
        isNull(schema.rentRollBatches.archivedAt),
      ),
    )
    .orderBy(desc(schema.rentRollBatches.asOfDate), desc(schema.rentRollBatches.createdAt))
    .limit(1);

  const unitGroupId = await db().transaction(async (tx) => {
    let groupId = existing?.unitGroupId;
    if (!groupId) {
      const [{ maxOrder }] = await tx
        .select({
          maxOrder: sql<number>`coalesce(max(${schema.interiorUnitGroups.sortOrder}), -1)::int`,
        })
        .from(schema.interiorUnitGroups)
        .where(eq(schema.interiorUnitGroups.propertyId, d.propertyId));

      const [row] = await tx
        .insert(schema.interiorUnitGroups)
        .values({
          propertyId: d.propertyId,
          name: d.floorPlanCode || "Unspecified",
          bedrooms: fact.bedrooms,
          baths: fact.baths != null ? fact.baths.toFixed(1) : null,
          sourceBatchId: batch?.id ?? null,
          sortOrder: maxOrder + 1,
        })
        .returning({ id: schema.interiorUnitGroups.id });
      groupId = row.id;

      await tx.insert(schema.interiorUnitGroupFloorplans).values({
        propertyId: d.propertyId,
        unitGroupId: groupId,
        floorPlanCode: d.floorPlanCode,
      });
    }

    await tx
      .insert(schema.interiorBudgetPlan)
      .values({
        propertyId: d.propertyId,
        unitGroupId: groupId,
        budgetGroupId: d.budgetGroupId,
        plannedUnits: d.units,
      })
      .onConflictDoUpdate({
        target: [schema.interiorBudgetPlan.unitGroupId, schema.interiorBudgetPlan.budgetGroupId],
        set: { plannedUnits: d.units },
      });

    return groupId;
  });

  await revalidateBudget(d.propertyId);
  return { ok: true, unitGroupId };
}

const bulkPlanSchema = z.object({
  propertyId: z.coerce.number().int().positive(),
  budgetGroupId: z.coerce.number().int().positive(),
});

/**
 * Offer one tier to EVERY unit group, at each group's full unit count.
 *
 * This is the only way into a budget from nothing. A column exists only where a
 * plan row does, the tier list itself is derived from the plan rows, and
 * `upsertPlanCell` can only be reached from a column that already renders — so a
 * property with zero plan rows (a fresh one, or one whose rows were cascaded away
 * by a re-seed) would otherwise have no path to a budget at all.
 *
 * It deliberately takes no volume: planning each floorplan's REMAINING capacity is
 * the one starting point that needs no judgement, and each column is then edited
 * down to its real count. Remaining rather than full, so bulk-planning a second
 * renovation type can't put every floorplan at 200%.
 */
export async function planTierForAllGroups(
  input: z.input<typeof bulkPlanSchema>,
): Promise<ActionResult<{ groups: number; units: number }>> {
  const parsed = bulkPlanSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const d = parsed.data;

  const tier = await db().query.budgetGroups.findFirst({
    where: eq(schema.budgetGroups.id, d.budgetGroupId),
    columns: { propertyId: true },
  });
  if (!tier || tier.propertyId !== d.propertyId) {
    return { ok: false, error: "Upgrade tier not found for this property" };
  }

  // Unit counts are derived from the rent roll, so they come from the sanctioned
  // compute path rather than a hand-rolled join.
  const budget = await computeInteriorBudgetFor(d.propertyId);
  if (budget.unitGroups.length === 0) {
    return { ok: false, error: "No unit groups yet — seed them from the rent roll first." };
  }

  const plannedElsewhere = new Map<number, number>();
  for (const c of budget.columns) {
    if (c.tierId === d.budgetGroupId) continue;
    plannedElsewhere.set(c.unitGroupId, (plannedElsewhere.get(c.unitGroupId) ?? 0) + c.plannedUnits);
  }

  const values = budget.unitGroups.map((g) => ({
    propertyId: d.propertyId,
    unitGroupId: g.id,
    budgetGroupId: d.budgetGroupId,
    plannedUnits: Math.max(0, Math.round(g.unitCount) - (plannedElsewhere.get(g.id) ?? 0)),
  }));

  await db()
    .insert(schema.interiorBudgetPlan)
    .values(values)
    .onConflictDoUpdate({
      target: [schema.interiorBudgetPlan.unitGroupId, schema.interiorBudgetPlan.budgetGroupId],
      set: { plannedUnits: sql`excluded.planned_units` },
    });

  await revalidateBudget(d.propertyId);
  return {
    ok: true,
    groups: values.length,
    units: values.reduce((s, v) => s + v.plannedUnits, 0),
  };
}

/** Stop offering a tier to a unit group — drops the column. Overrides are unaffected. */
export async function removePlanCell(input: {
  propertyId: number;
  unitGroupId: number;
  budgetGroupId: number;
}): Promise<ActionResult> {
  const propertyId = Number(input.propertyId);
  await db()
    .delete(schema.interiorBudgetPlan)
    .where(
      and(
        eq(schema.interiorBudgetPlan.propertyId, propertyId),
        eq(schema.interiorBudgetPlan.unitGroupId, Number(input.unitGroupId)),
        eq(schema.interiorBudgetPlan.budgetGroupId, Number(input.budgetGroupId)),
      ),
    );
  await revalidateBudget(propertyId);
  return { ok: true };
}

const overrideSchema = z.object({
  propertyId: z.coerce.number().int().positive(),
  budgetGroupId: z.coerce.number().int().positive(),
  costCodeId: z.coerce.number().int().positive(),
  unitGroupId: z.coerce.number().int().positive(),
  /** A finished dollar amount for this cell, never a rate. */
  amount: z.coerce.number().nonnegative("Amount can't be negative"),
  note: z.string().trim().optional().nullable(),
});

/**
 * Override one cell with an explicit amount instead of the tier's default
 * pricing. This is how a negotiated quote that differs by floorplan gets
 * expressed ("GC quoted $2,500 for 2BR counters").
 *
 * Deliberately a distinct gesture from editing the row's unit price: the row
 * header propagates to every column, an override affects exactly one cell.
 */
export async function upsertOverride(input: z.input<typeof overrideSchema>): Promise<ActionResult> {
  const parsed = overrideSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const d = parsed.data;

  const bad = await assertOwnership(d.propertyId, d.unitGroupId, d.budgetGroupId);
  if (bad) return { ok: false, error: bad };

  // The tier must actually carry this cost code, or the override would be orphaned.
  const line = await db().query.budgetGroupLines.findFirst({
    where: and(
      eq(schema.budgetGroupLines.budgetGroupId, d.budgetGroupId),
      eq(schema.budgetGroupLines.costCodeId, d.costCodeId),
    ),
    columns: { id: true },
  });
  if (!line) return { ok: false, error: "That tier has no line for this cost code" };

  await db()
    .insert(schema.interiorBudgetLineOverrides)
    .values({
      propertyId: d.propertyId,
      budgetGroupId: d.budgetGroupId,
      costCodeId: d.costCodeId,
      unitGroupId: d.unitGroupId,
      amount: d.amount.toFixed(2),
      note: d.note ?? null,
    })
    .onConflictDoUpdate({
      target: [
        schema.interiorBudgetLineOverrides.budgetGroupId,
        schema.interiorBudgetLineOverrides.costCodeId,
        schema.interiorBudgetLineOverrides.unitGroupId,
      ],
      set: { amount: d.amount.toFixed(2), note: d.note ?? null },
    });

  await revalidateBudget(d.propertyId);
  return { ok: true };
}

/** Remove a custom override, returning the cell to its default derived value. */
export async function clearOverride(input: {
  propertyId: number;
  budgetGroupId: number;
  costCodeId: number;
  unitGroupId: number;
}): Promise<ActionResult> {
  const propertyId = Number(input.propertyId);
  await db()
    .delete(schema.interiorBudgetLineOverrides)
    .where(
      and(
        eq(schema.interiorBudgetLineOverrides.propertyId, propertyId),
        eq(schema.interiorBudgetLineOverrides.budgetGroupId, Number(input.budgetGroupId)),
        eq(schema.interiorBudgetLineOverrides.costCodeId, Number(input.costCodeId)),
        eq(schema.interiorBudgetLineOverrides.unitGroupId, Number(input.unitGroupId)),
      ),
    );
  await revalidateBudget(propertyId);
  return { ok: true };
}

const ratesSchema = z.object({
  propertyId: z.coerce.number().int().positive(),
  cmSupervisionPct: z.coerce.number().min(0).max(100),
  contingencyPct: z.coerce.number().min(0).max(100),
});

/**
 * Edit just the two uplift percentages, for inline editing on the pivot's footer
 * rows. Deliberately does not touch the cost-code pointers — `updateInteriorSettings`
 * would null them if they were omitted, which would silently break the pivot's
 * reconciliation to the Interiors division.
 */
export async function updateUpliftRates(
  input: z.input<typeof ratesSchema>,
): Promise<ActionResult> {
  const parsed = ratesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const d = parsed.data;

  await db()
    .insert(schema.interiorBudgetSettings)
    .values({
      propertyId: d.propertyId,
      cmSupervisionPct: d.cmSupervisionPct.toFixed(3),
      contingencyPct: d.contingencyPct.toFixed(3),
    })
    .onConflictDoUpdate({
      target: schema.interiorBudgetSettings.propertyId,
      set: {
        cmSupervisionPct: d.cmSupervisionPct.toFixed(3),
        contingencyPct: d.contingencyPct.toFixed(3),
        updatedAt: new Date(),
      },
    });

  await revalidateBudget(d.propertyId);
  return { ok: true };
}

const settingsSchema = z.object({
  propertyId: z.coerce.number().int().positive(),
  cmSupervisionPct: z.coerce.number().min(0).max(100),
  contingencyPct: z.coerce.number().min(0).max(100),
  cmCostCodeId: z.coerce.number().int().positive().optional().nullable(),
  contingencyCostCodeId: z.coerce.number().int().positive().optional().nullable(),
});

/**
 * Set the uplift rates and the cost codes they're attributed to.
 *
 * The cost-code pointers matter: without them the uplift dollars sit outside the
 * cost-code tree and the pivot's grand total stops reconciling to the Budget
 * tab's Interiors division. Both codes must be interior codes in this property's
 * chart.
 */
export async function updateInteriorSettings(
  input: z.input<typeof settingsSchema>,
): Promise<ActionResult> {
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const d = parsed.data;

  const property = await db().query.properties.findFirst({
    where: eq(schema.properties.id, d.propertyId),
    columns: { chartOfAccountsId: true },
  });
  if (!property) return { ok: false, error: "Property not found" };

  for (const [label, codeId] of [
    ["CM / supervision", d.cmCostCodeId],
    ["Contingency", d.contingencyCostCodeId],
  ] as const) {
    if (codeId == null) continue;
    const code = await db().query.costCodes.findFirst({
      where: eq(schema.costCodes.id, codeId),
      columns: { chartId: true, isInterior: true },
    });
    if (!code || code.chartId !== property.chartOfAccountsId) {
      return { ok: false, error: `${label} cost code isn't in this property's chart` };
    }
    if (!code.isInterior) {
      return {
        ok: false,
        error: `${label} must post to an interior cost code, or the pivot won't reconcile to the Interiors division`,
      };
    }
  }

  await db()
    .insert(schema.interiorBudgetSettings)
    .values({
      propertyId: d.propertyId,
      cmSupervisionPct: d.cmSupervisionPct.toFixed(3),
      contingencyPct: d.contingencyPct.toFixed(3),
      cmCostCodeId: d.cmCostCodeId ?? null,
      contingencyCostCodeId: d.contingencyCostCodeId ?? null,
    })
    .onConflictDoUpdate({
      target: schema.interiorBudgetSettings.propertyId,
      set: {
        cmSupervisionPct: d.cmSupervisionPct.toFixed(3),
        contingencyPct: d.contingencyPct.toFixed(3),
        cmCostCodeId: d.cmCostCodeId ?? null,
        contingencyCostCodeId: d.contingencyCostCodeId ?? null,
        updatedAt: new Date(),
      },
    });

  await revalidateBudget(d.propertyId);
  return { ok: true };
}

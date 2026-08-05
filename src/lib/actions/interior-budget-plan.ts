"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import type { ActionResult } from "@/lib/action-result";
import { computeInteriorBudgetFor } from "@/lib/interior-budget";
import { roundMoney } from "@/lib/pricing";
import { propertyPath } from "@/lib/property-path";

// ---------------------------------------------------------------------------
// The interior budget plan: how many units of each group get each upgrade tier,
// the pinned cell amounts, and the property's uplift rates.
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

const planSchema = z.object({
  propertyId: z.coerce.number().int().positive(),
  unitGroupId: z.coerce.number().int().positive(),
  budgetGroupId: z.coerce.number().int().positive(),
  /**
   * Fractional on purpose. Penetration is entered as a percentage and lands on
   * values like 205.1 units; rounding would shift the budget and break the tie
   * to the underwriting model. The UI converts a percentage to units before
   * calling — this is the single stored value.
   */
  plannedUnits: z.coerce.number().nonnegative("Planned units can't be negative"),
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

  await db()
    .insert(schema.interiorBudgetPlan)
    .values({
      propertyId: d.propertyId,
      unitGroupId: d.unitGroupId,
      budgetGroupId: d.budgetGroupId,
      plannedUnits: d.plannedUnits.toFixed(2),
      note: d.note ?? null,
    })
    .onConflictDoUpdate({
      target: [schema.interiorBudgetPlan.unitGroupId, schema.interiorBudgetPlan.budgetGroupId],
      set: { plannedUnits: d.plannedUnits.toFixed(2), note: d.note ?? null },
    });

  await revalidateBudget(d.propertyId);
  return { ok: true };
}

const bulkPlanSchema = z.object({
  propertyId: z.coerce.number().int().positive(),
  budgetGroupId: z.coerce.number().int().positive(),
  penetrationPct: z.coerce.number().min(0).max(100),
});

/**
 * Offer one tier to EVERY unit group at a single penetration.
 *
 * This is the only way into a budget from nothing. A column exists only where a
 * plan row does, the tier list itself is derived from the plan rows, and
 * `upsertPlanCell` can only be reached from a column that already renders — so a
 * property with zero plan rows (a fresh one, or one whose rows were cascaded away
 * by a re-seed) would otherwise have no path to a budget at all.
 *
 * Per-column penetration is then tuned through `upsertPlanCell` as usual; this
 * only lays down the starting grid.
 */
export async function planTierForAllGroups(
  input: z.input<typeof bulkPlanSchema>,
): Promise<ActionResult<{ groups: number }>> {
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

  const values = budget.unitGroups.map((g) => ({
    propertyId: d.propertyId,
    unitGroupId: g.id,
    budgetGroupId: d.budgetGroupId,
    plannedUnits: roundMoney(g.unitCount * (d.penetrationPct / 100)).toFixed(2),
  }));

  await db()
    .insert(schema.interiorBudgetPlan)
    .values(values)
    .onConflictDoUpdate({
      target: [schema.interiorBudgetPlan.unitGroupId, schema.interiorBudgetPlan.budgetGroupId],
      set: { plannedUnits: sql`excluded.planned_units` },
    });

  await revalidateBudget(d.propertyId);
  return { ok: true, groups: values.length };
}

/** Stop offering a tier to a unit group — drops the column. Pins are unaffected. */
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

const pinSchema = z.object({
  propertyId: z.coerce.number().int().positive(),
  budgetGroupId: z.coerce.number().int().positive(),
  costCodeId: z.coerce.number().int().positive(),
  unitGroupId: z.coerce.number().int().positive(),
  /** A finished dollar amount for this cell, never a rate. */
  amount: z.coerce.number().nonnegative("Amount can't be negative"),
  note: z.string().trim().optional().nullable(),
});

/**
 * Pin one cell to an explicit amount, overriding what the pricing method would
 * derive. This is how a negotiated quote that differs by floorplan gets
 * expressed ("GC quoted $2,500 for 2BR counters").
 *
 * Deliberately a distinct gesture from editing the row's unit price: the row
 * header propagates to every column, a pin affects exactly one cell.
 */
export async function upsertPin(input: z.input<typeof pinSchema>): Promise<ActionResult> {
  const parsed = pinSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const d = parsed.data;

  const bad = await assertOwnership(d.propertyId, d.unitGroupId, d.budgetGroupId);
  if (bad) return { ok: false, error: bad };

  // The tier must actually carry this cost code, or the pin would be orphaned —
  // it'd sit in the table forever with nothing to override.
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

/** Drop a pin, returning the cell to its derived value. */
export async function clearPin(input: {
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

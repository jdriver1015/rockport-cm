import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { assertBudgetUnlockedForUpdate } from "@/lib/property-budget-lock";
import { propertyPath } from "@/lib/property-path";
import type { ActionResult } from "@/lib/action-result";

// ---------------------------------------------------------------------------
// Pure DB layer behind actions/budget.ts's "use server" wrappers (auth +
// FormData parsing) — kept separate so a probe can exercise these without a
// live Supabase session, the same split property-budget-import.ts and
// property-budget-lock.ts use for the same reason.
//
// Each function checks the lock and writes inside one transaction, via
// assertBudgetUnlockedForUpdate's row lock on the property — not a plain read
// followed by a separate write, which would leave a gap for a concurrent
// lockBudget to land in unnoticed.
// ---------------------------------------------------------------------------

export async function createBudgetLineCore(input: {
  propertyId: number;
  costCodeId: number;
  uwAmount?: number;
  perUnitAmount?: number;
  plannedUnits?: number;
  note?: string;
}): Promise<ActionResult> {
  const { propertyId, costCodeId, perUnitAmount, plannedUnits, note } = input;

  const costCode = await db().query.costCodes.findFirst({
    where: eq(schema.costCodes.id, costCodeId),
  });
  if (!costCode) return { ok: false, error: "Cost code not found" };

  // The code must belong to this property's chart of accounts.
  const property = await db().query.properties.findFirst({
    where: eq(schema.properties.id, propertyId),
    columns: { chartOfAccountsId: true },
  });
  if (!property) return { ok: false, error: "Property not found" };
  if (costCode.chartId !== property.chartOfAccountsId) {
    return { ok: false, error: "That cost code isn't in this property's chart of accounts" };
  }

  const uwAmount =
    perUnitAmount !== undefined && plannedUnits !== undefined
      ? perUnitAmount * plannedUnits
      : (input.uwAmount ?? 0);
  if (uwAmount <= 0) {
    return { ok: false, error: "Enter a budgeted amount" };
  }

  const result = await db().transaction(async (tx): Promise<ActionResult> => {
    const lockCheck = await assertBudgetUnlockedForUpdate(tx, propertyId);
    if (!lockCheck.ok) return lockCheck;

    const existing = await tx.query.budgetLines.findFirst({
      where: and(
        eq(schema.budgetLines.propertyId, propertyId),
        eq(schema.budgetLines.costCodeId, costCodeId),
        isNull(schema.budgetLines.archivedAt),
      ),
    });
    if (existing) {
      return { ok: false, error: `${costCode.name} already has a budget line for this property` };
    }

    await tx.insert(schema.budgetLines).values({
      propertyId,
      costCodeId,
      uwAmount: uwAmount.toFixed(2),
      perUnitAmount: perUnitAmount !== undefined ? perUnitAmount.toFixed(2) : undefined,
      plannedUnits,
      note,
    });
    return { ok: true };
  });

  if (result.ok) {
    const path = await propertyPath(propertyId, "/budget");
    if (path) revalidatePath(path);
    revalidatePath("/");
  }
  return result;
}

export async function updateBudgetLineCore(input: {
  id: number;
  propertyId: number;
  uwAmount?: number;
  perUnitAmount?: number;
  plannedUnits?: number;
  note?: string;
}): Promise<ActionResult> {
  const { id, propertyId, perUnitAmount, plannedUnits, note } = input;

  const line = await db().query.budgetLines.findFirst({
    where: eq(schema.budgetLines.id, id),
  });
  if (!line || line.propertyId !== propertyId) {
    return { ok: false, error: "Budget line not found" };
  }

  // Interior lines budget per unit; others take a direct amount.
  const uwAmount =
    perUnitAmount !== undefined && plannedUnits !== undefined
      ? perUnitAmount * plannedUnits
      : (input.uwAmount ?? 0);
  if (uwAmount <= 0) {
    return { ok: false, error: "Enter a budgeted amount" };
  }

  const result = await db().transaction(async (tx): Promise<ActionResult> => {
    const lockCheck = await assertBudgetUnlockedForUpdate(tx, propertyId);
    if (!lockCheck.ok) return lockCheck;

    await tx
      .update(schema.budgetLines)
      .set({
        uwAmount: uwAmount.toFixed(2),
        perUnitAmount: perUnitAmount !== undefined ? perUnitAmount.toFixed(2) : null,
        plannedUnits: plannedUnits ?? null,
        note: note ?? null,
        updatedAt: new Date(),
      })
      .where(eq(schema.budgetLines.id, id));
    return { ok: true };
  });

  if (result.ok) {
    const path = await propertyPath(propertyId, "/budget");
    if (path) revalidatePath(path);
    revalidatePath("/");
  }
  return result;
}

export async function deleteBudgetLineCore(input: { id: number; propertyId: number }): Promise<ActionResult> {
  const line = await db().query.budgetLines.findFirst({
    where: eq(schema.budgetLines.id, input.id),
  });
  if (!line || line.propertyId !== input.propertyId) {
    return { ok: false, error: "Budget line not found" };
  }

  const result = await db().transaction(async (tx): Promise<ActionResult> => {
    const lockCheck = await assertBudgetUnlockedForUpdate(tx, input.propertyId);
    if (!lockCheck.ok) return lockCheck;

    await tx
      .update(schema.budgetLines)
      .set({ archivedAt: new Date() })
      .where(eq(schema.budgetLines.id, input.id));
    return { ok: true };
  });

  if (result.ok) {
    const path = await propertyPath(input.propertyId, "/budget");
    if (path) revalidatePath(path);
    revalidatePath("/");
  }
  return result;
}

/** Reverses deleteBudgetLineCore — used by the delete toast's Undo action. */
export async function restoreBudgetLineCore(input: { id: number; propertyId: number }): Promise<ActionResult> {
  const line = await db().query.budgetLines.findFirst({
    where: eq(schema.budgetLines.id, input.id),
  });
  if (!line || line.propertyId !== input.propertyId) {
    return { ok: false, error: "Budget line not found" };
  }

  const result = await db().transaction(async (tx): Promise<ActionResult> => {
    const lockCheck = await assertBudgetUnlockedForUpdate(tx, input.propertyId);
    if (!lockCheck.ok) return lockCheck;

    await tx
      .update(schema.budgetLines)
      .set({ archivedAt: null })
      .where(eq(schema.budgetLines.id, input.id));
    return { ok: true };
  });

  if (result.ok) {
    const path = await propertyPath(input.propertyId, "/budget");
    if (path) revalidatePath(path);
    revalidatePath("/");
  }
  return result;
}

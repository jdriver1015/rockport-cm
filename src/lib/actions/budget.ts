"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import type { ActionResult } from "@/lib/action-result";

const createBudgetLineSchema = z.object({
  propertyId: z.coerce.number().int().positive(),
  costCodeId: z.coerce.number().int().positive(),
  uwAmount: z.coerce.number().nonnegative().optional(),
  perUnitAmount: z.coerce.number().nonnegative().optional(),
  plannedUnits: z.coerce.number().int().nonnegative().optional(),
  note: z.string().trim().optional(),
});

export async function createBudgetLine(formData: FormData): Promise<ActionResult> {
  const parsed = createBudgetLineSchema.safeParse({
    propertyId: formData.get("propertyId"),
    costCodeId: formData.get("costCodeId"),
    uwAmount: formData.get("uwAmount") || undefined,
    perUnitAmount: formData.get("perUnitAmount") || undefined,
    plannedUnits: formData.get("plannedUnits") || undefined,
    note: formData.get("note") || undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { propertyId, costCodeId, perUnitAmount, plannedUnits, note } = parsed.data;

  const costCode = await db().query.costCodes.findFirst({
    where: eq(schema.costCodes.id, costCodeId),
  });
  if (!costCode) return { ok: false, error: "Cost code not found" };

  const existing = await db().query.budgetLines.findFirst({
    where: and(
      eq(schema.budgetLines.propertyId, propertyId),
      eq(schema.budgetLines.costCodeId, costCodeId),
      isNull(schema.budgetLines.archivedAt),
    ),
  });
  if (existing) {
    return { ok: false, error: `${costCode.code} already has a budget line for this property` };
  }

  const uwAmount =
    perUnitAmount !== undefined && plannedUnits !== undefined
      ? perUnitAmount * plannedUnits
      : (parsed.data.uwAmount ?? 0);

  if (uwAmount <= 0) {
    return { ok: false, error: "Enter a budgeted amount" };
  }

  await db()
    .insert(schema.budgetLines)
    .values({
      propertyId,
      costCodeId,
      uwAmount: uwAmount.toFixed(2),
      perUnitAmount: perUnitAmount !== undefined ? perUnitAmount.toFixed(2) : undefined,
      plannedUnits,
      note,
    });

  revalidatePath(`/properties/${propertyId}/budget`);
  revalidatePath("/");
  return { ok: true };
}

const updateBudgetLineSchema = z.object({
  id: z.coerce.number().int().positive(),
  propertyId: z.coerce.number().int().positive(),
  uwAmount: z.coerce.number().nonnegative().optional(),
  perUnitAmount: z.coerce.number().nonnegative().optional(),
  plannedUnits: z.coerce.number().int().nonnegative().optional(),
  note: z.string().trim().optional(),
});

export async function updateBudgetLine(input: {
  id: number;
  propertyId: number;
  uwAmount?: string | number;
  perUnitAmount?: string | number;
  plannedUnits?: string | number;
  note?: string;
}): Promise<ActionResult> {
  const parsed = updateBudgetLineSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { id, propertyId, perUnitAmount, plannedUnits, note } = parsed.data;

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
      : (parsed.data.uwAmount ?? 0);

  if (uwAmount <= 0) {
    return { ok: false, error: "Enter a budgeted amount" };
  }

  await db()
    .update(schema.budgetLines)
    .set({
      uwAmount: uwAmount.toFixed(2),
      perUnitAmount: perUnitAmount !== undefined ? perUnitAmount.toFixed(2) : null,
      plannedUnits: plannedUnits ?? null,
      note: note ?? null,
      updatedAt: new Date(),
    })
    .where(eq(schema.budgetLines.id, id));

  revalidatePath(`/properties/${propertyId}/budget`);
  revalidatePath("/");
  return { ok: true };
}

export async function deleteBudgetLine(input: {
  id: number;
  propertyId: number;
}): Promise<ActionResult> {
  const line = await db().query.budgetLines.findFirst({
    where: eq(schema.budgetLines.id, input.id),
  });
  if (!line || line.propertyId !== input.propertyId) {
    return { ok: false, error: "Budget line not found" };
  }

  await db()
    .update(schema.budgetLines)
    .set({ archivedAt: new Date() })
    .where(eq(schema.budgetLines.id, input.id));

  revalidatePath(`/properties/${input.propertyId}/budget`);
  revalidatePath("/");
  return { ok: true };
}

/** Reverses deleteBudgetLine — used by the delete toast's Undo action. */
export async function restoreBudgetLine(input: {
  id: number;
  propertyId: number;
}): Promise<ActionResult> {
  const line = await db().query.budgetLines.findFirst({
    where: eq(schema.budgetLines.id, input.id),
  });
  if (!line || line.propertyId !== input.propertyId) {
    return { ok: false, error: "Budget line not found" };
  }

  await db()
    .update(schema.budgetLines)
    .set({ archivedAt: null })
    .where(eq(schema.budgetLines.id, input.id));

  revalidatePath(`/properties/${input.propertyId}/budget`);
  revalidatePath("/");
  return { ok: true };
}

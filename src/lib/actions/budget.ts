"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
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

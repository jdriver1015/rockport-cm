"use server";

import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { requireUser } from "@/lib/auth";
import { canWriteProperty } from "@/lib/auth-rules";
import {
  createBudgetLineCore,
  updateBudgetLineCore,
  deleteBudgetLineCore,
  restoreBudgetLineCore,
} from "@/lib/budget-lines";

const createBudgetLineSchema = z.object({
  propertyId: z.coerce.number().int().positive(),
  costCodeId: z.coerce.number().int().positive(),
  uwAmount: z.coerce.number().nonnegative().optional(),
  perUnitAmount: z.coerce.number().nonnegative().optional(),
  plannedUnits: z.coerce.number().int().nonnegative().optional(),
  note: z.string().trim().optional(),
});

export async function createBudgetLine(formData: FormData): Promise<ActionResult> {
  // Auth gate: every action that mutates a budget line must require a
  // signed-in user with write scope. (See src/lib/auth.ts for the helper and
  // src/lib/auth-rules.ts for the matrix.)
  const auth = await requireUser();
  if (!auth.ok) return auth;
  if (!canWriteProperty(auth.profile.role)) {
    return { ok: false, error: "You don't have permission to edit this budget" };
  }

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
  return createBudgetLineCore(parsed.data);
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
  const auth = await requireUser();
  if (!auth.ok) return auth;
  if (!canWriteProperty(auth.profile.role)) {
    return { ok: false, error: "You don't have permission to edit this budget" };
  }

  const parsed = updateBudgetLineSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  return updateBudgetLineCore(parsed.data);
}

export async function deleteBudgetLine(input: {
  id: number;
  propertyId: number;
}): Promise<ActionResult> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  if (!canWriteProperty(auth.profile.role)) {
    return { ok: false, error: "You don't have permission to edit this budget" };
  }
  return deleteBudgetLineCore(input);
}

/** Reverses deleteBudgetLine — used by the delete toast's Undo action. */
export async function restoreBudgetLine(input: {
  id: number;
  propertyId: number;
}): Promise<ActionResult> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  if (!canWriteProperty(auth.profile.role)) {
    return { ok: false, error: "You don't have permission to edit this budget" };
  }
  return restoreBudgetLineCore(input);
}

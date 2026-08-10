"use server";

import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import type { ActionResult } from "@/lib/action-result";
import { SCOPE_STATUS_KEYS } from "@/lib/scope-status";
import { propertyProjectPath } from "@/lib/property-path";

async function revalidateProject(propertyId: number, projectId: number) {
  const path = await propertyProjectPath(propertyId, projectId);
  if (path) revalidatePath(path);
}

const optionalNumeric = z
  .string()
  .trim()
  .nullish()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || !Number.isNaN(Number(v)), "Enter a valid number");

const optionalCostCodeId = z
  .string()
  .trim()
  .nullish()
  .transform((v) => (v ? Number(v) : null))
  .refine((v) => v === null || Number.isInteger(v), "Invalid budget line");

const createSchema = z.object({
  propertyId: z.coerce.number().int().positive(),
  projectId: z.coerce.number().int().positive(),
  item: z.string().trim().min(1, "Item is required"),
  materialQuality: z
    .string()
    .trim()
    .nullish()
    .transform((v) => (v ? v : null)),
  quantity: optionalNumeric,
  unitPrice: optionalNumeric,
  costCodeId: optionalCostCodeId,
});

export async function createScopeItem(formData: FormData): Promise<ActionResult> {
  const parsed = createSchema.safeParse({
    propertyId: formData.get("propertyId"),
    projectId: formData.get("projectId"),
    item: formData.get("item"),
    materialQuality: formData.get("materialQuality"),
    quantity: formData.get("quantity"),
    unitPrice: formData.get("unitPrice"),
    costCodeId: formData.get("costCodeId"),
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const d = parsed.data;

  const [{ maxOrder }] = await db()
    .select({ maxOrder: sql<number>`coalesce(max(${schema.scopeItems.sortOrder}), 0)::int` })
    .from(schema.scopeItems)
    .where(eq(schema.scopeItems.projectId, d.projectId));

  await db().insert(schema.scopeItems).values({
    projectId: d.projectId,
    item: d.item,
    materialQuality: d.materialQuality,
    quantity: d.quantity,
    unitPrice: d.unitPrice,
    costCodeId: d.costCodeId,
    sortOrder: maxOrder + 1,
  });
  await revalidateProject(d.propertyId, d.projectId);
  return { ok: true };
}

export async function updateScopeItem(input: {
  id: number;
  propertyId: number;
  projectId: number;
  item?: string;
  materialQuality?: string | null;
  quantity?: string | null;
  unitPrice?: string | null;
  costCodeId?: number | null;
}): Promise<ActionResult> {
  const set: Partial<typeof schema.scopeItems.$inferInsert> = {};

  if (input.item !== undefined) {
    const trimmed = input.item.trim();
    if (!trimmed) return { ok: false, error: "Item is required" };
    set.item = trimmed;
  }
  if (input.materialQuality !== undefined) {
    set.materialQuality = input.materialQuality?.trim() || null;
  }
  if (input.quantity !== undefined) {
    const trimmed = input.quantity?.trim() || null;
    if (trimmed !== null && Number.isNaN(Number(trimmed))) {
      return { ok: false, error: "Enter a valid units value" };
    }
    set.quantity = trimmed;
  }
  if (input.unitPrice !== undefined) {
    const trimmed = input.unitPrice?.trim() || null;
    if (trimmed !== null && Number.isNaN(Number(trimmed))) {
      return { ok: false, error: "Enter a valid unit cost" };
    }
    set.unitPrice = trimmed;
  }
  if (input.costCodeId !== undefined) {
    set.costCodeId = input.costCodeId;
  }

  if (Object.keys(set).length === 0) return { ok: true };
  await db().update(schema.scopeItems).set(set).where(eq(schema.scopeItems.id, input.id));
  await revalidateProject(input.propertyId, input.projectId);
  return { ok: true };
}

export async function deleteScopeItem(input: {
  id: number;
  propertyId: number;
  projectId: number;
}): Promise<ActionResult> {
  await db()
    .update(schema.scopeItems)
    .set({ archivedAt: new Date() })
    .where(eq(schema.scopeItems.id, input.id));
  await revalidateProject(input.propertyId, input.projectId);
  return { ok: true };
}

/** Reverses deleteScopeItem — used by the delete toast's Undo action. */
export async function restoreScopeItem(input: {
  id: number;
  propertyId: number;
  projectId: number;
}): Promise<ActionResult> {
  await db()
    .update(schema.scopeItems)
    .set({ archivedAt: null })
    .where(eq(schema.scopeItems.id, input.id));
  await revalidateProject(input.propertyId, input.projectId);
  return { ok: true };
}

const statusSchema = z.object({
  id: z.coerce.number().int().positive(),
  propertyId: z.coerce.number().int().positive(),
  projectId: z.coerce.number().int().positive(),
  status: z.enum(SCOPE_STATUS_KEYS),
});

/** Flip one scope line's progress — driven inline from the scope table. */
export async function setScopeItemStatus(input: {
  id: number;
  propertyId: number;
  projectId: number;
  status: string;
}): Promise<ActionResult> {
  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid status" };
  }
  const { id, propertyId, projectId, status } = parsed.data;

  const line = await db().query.scopeItems.findFirst({
    where: eq(schema.scopeItems.id, id),
  });
  if (!line || line.projectId !== projectId) return { ok: false, error: "Scope item not found" };

  await db().update(schema.scopeItems).set({ status }).where(eq(schema.scopeItems.id, id));
  await revalidateProject(propertyId, projectId);
  return { ok: true };
}

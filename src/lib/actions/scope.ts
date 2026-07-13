"use server";

import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import type { ActionResult } from "@/lib/action-result";
import { SCOPE_STATUS_KEYS } from "@/lib/scope";

function revalidateProject(propertyId: number, projectId: number) {
  revalidatePath(`/properties/${propertyId}/projects/${projectId}`);
}

const money = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined))
  .refine((v) => v === undefined || !Number.isNaN(Number(v)), "Enter a number")
  .transform((v) => (v === undefined ? null : Number(v).toFixed(2)));

const createSchema = z.object({
  propertyId: z.coerce.number().int().positive(),
  projectId: z.coerce.number().int().positive(),
  item: z.string().trim().min(1, "Item is required"),
  quantity: money,
  unitCost: money,
  vendor: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : null)),
  status: z.enum(SCOPE_STATUS_KEYS as [string, ...string[]]).default("planned"),
});

export async function createScopeItem(formData: FormData): Promise<ActionResult> {
  const parsed = createSchema.safeParse({
    propertyId: formData.get("propertyId"),
    projectId: formData.get("projectId"),
    item: formData.get("item"),
    quantity: formData.get("quantity"),
    unitCost: formData.get("unitCost"),
    vendor: formData.get("vendor"),
    status: formData.get("status") || "planned",
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
    quantity: d.quantity,
    unitCost: d.unitCost,
    vendor: d.vendor,
    status: d.status,
    sortOrder: maxOrder + 1,
  });
  revalidateProject(d.propertyId, d.projectId);
  return { ok: true };
}

export async function updateScopeItem(input: {
  id: number;
  propertyId: number;
  projectId: number;
  item?: string;
  quantity?: string | null;
  unitCost?: string | null;
  vendor?: string | null;
  status?: string;
}): Promise<ActionResult> {
  const set: Partial<typeof schema.scopeItems.$inferInsert> = {};

  if (input.item !== undefined) {
    const trimmed = input.item.trim();
    if (!trimmed) return { ok: false, error: "Item is required" };
    set.item = trimmed;
  }
  for (const key of ["quantity", "unitCost"] as const) {
    const v = input[key];
    if (v === undefined) continue;
    if (v === null || v === "") {
      set[key] = null;
    } else if (Number.isNaN(Number(v))) {
      return { ok: false, error: "Enter a number" };
    } else {
      set[key] = Number(v).toFixed(2);
    }
  }
  if (input.vendor !== undefined) set.vendor = input.vendor?.trim() || null;
  if (input.status !== undefined) {
    if (!SCOPE_STATUS_KEYS.includes(input.status as (typeof SCOPE_STATUS_KEYS)[number])) {
      return { ok: false, error: "Invalid status" };
    }
    set.status = input.status;
  }

  if (Object.keys(set).length === 0) return { ok: true };
  await db().update(schema.scopeItems).set(set).where(eq(schema.scopeItems.id, input.id));
  revalidateProject(input.propertyId, input.projectId);
  return { ok: true };
}

export async function deleteScopeItem(input: {
  id: number;
  propertyId: number;
  projectId: number;
}): Promise<ActionResult> {
  await db().delete(schema.scopeItems).where(eq(schema.scopeItems.id, input.id));
  revalidateProject(input.propertyId, input.projectId);
  return { ok: true };
}

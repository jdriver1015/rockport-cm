"use server";

import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import type { ActionResult } from "@/lib/action-result";
import { SCOPE_STATUS_KEYS } from "@/lib/scope-status";

function revalidateProject(propertyId: number, projectId: number) {
  revalidatePath(`/properties/${propertyId}/projects/${projectId}`);
}

// Optional URL — accept blank, otherwise require a parseable http(s) link.
const productLink = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || /^https?:\/\/.+/i.test(v), "Enter a valid http(s) link");

const createSchema = z.object({
  propertyId: z.coerce.number().int().positive(),
  projectId: z.coerce.number().int().positive(),
  item: z.string().trim().min(1, "Item is required"),
  materialQuality: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : null)),
  productLink,
  category: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : null)),
});

export async function createScopeItem(formData: FormData): Promise<ActionResult> {
  const parsed = createSchema.safeParse({
    propertyId: formData.get("propertyId"),
    projectId: formData.get("projectId"),
    item: formData.get("item"),
    materialQuality: formData.get("materialQuality"),
    productLink: formData.get("productLink"),
    category: formData.get("category"),
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
    productLink: d.productLink,
    category: d.category,
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
  materialQuality?: string | null;
  productLink?: string | null;
  category?: string | null;
}): Promise<ActionResult> {
  const set: Partial<typeof schema.scopeItems.$inferInsert> = {};

  if (input.category !== undefined) {
    set.category = input.category?.trim() || null;
  }

  if (input.item !== undefined) {
    const trimmed = input.item.trim();
    if (!trimmed) return { ok: false, error: "Item is required" };
    set.item = trimmed;
  }
  if (input.materialQuality !== undefined) {
    set.materialQuality = input.materialQuality?.trim() || null;
  }
  if (input.productLink !== undefined) {
    const link = input.productLink?.trim() || null;
    if (link !== null && !/^https?:\/\/.+/i.test(link)) {
      return { ok: false, error: "Enter a valid http(s) link" };
    }
    set.productLink = link;
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
  await db()
    .update(schema.scopeItems)
    .set({ archivedAt: new Date() })
    .where(eq(schema.scopeItems.id, input.id));
  revalidateProject(input.propertyId, input.projectId);
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
  revalidateProject(input.propertyId, input.projectId);
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
  revalidateProject(propertyId, projectId);
  return { ok: true };
}

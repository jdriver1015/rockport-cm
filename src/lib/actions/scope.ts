"use server";

import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import type { ActionResult } from "@/lib/action-result";

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
});

export async function createScopeItem(formData: FormData): Promise<ActionResult> {
  const parsed = createSchema.safeParse({
    propertyId: formData.get("propertyId"),
    projectId: formData.get("projectId"),
    item: formData.get("item"),
    materialQuality: formData.get("materialQuality"),
    productLink: formData.get("productLink"),
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
  await db().delete(schema.scopeItems).where(eq(schema.scopeItems.id, input.id));
  revalidateProject(input.propertyId, input.projectId);
  return { ok: true };
}

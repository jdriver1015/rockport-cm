"use server";

import { revalidatePath } from "next/cache";
import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import type { ActionResult } from "@/lib/action-result";

// ---------------------------------------------------------------------------
// Scope-group templates — the portfolio library managed under Settings. These
// are the base options offered when creating a per-property scope group.
// ---------------------------------------------------------------------------

function revalidateTemplates(templateId?: number) {
  revalidatePath("/settings/scope-groups");
  if (templateId != null) revalidatePath(`/settings/scope-groups/${templateId}`);
}

const templateSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  description: z.string().trim().optional(),
});

export async function createScopeTemplate(input: {
  name: string;
  description?: string;
}): Promise<ActionResult<{ templateId: number }>> {
  const parsed = templateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const [{ maxOrder }] = await db()
    .select({ maxOrder: sql<number>`coalesce(max(${schema.scopeGroupTemplates.sortOrder}), 0)::int` })
    .from(schema.scopeGroupTemplates);

  const [tpl] = await db()
    .insert(schema.scopeGroupTemplates)
    .values({ name: parsed.data.name, description: parsed.data.description, sortOrder: maxOrder + 1 })
    .returning({ id: schema.scopeGroupTemplates.id });
  revalidateTemplates();
  return { ok: true, templateId: tpl.id };
}

export async function updateScopeTemplate(input: {
  id: number;
  name: string;
  description?: string;
}): Promise<ActionResult> {
  const parsed = templateSchema.safeParse({ name: input.name, description: input.description });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  await db()
    .update(schema.scopeGroupTemplates)
    .set({ name: parsed.data.name, description: parsed.data.description ?? null })
    .where(eq(schema.scopeGroupTemplates.id, input.id));
  revalidateTemplates(input.id);
  return { ok: true };
}

/** Deep-copy a template and all its items into a new template. */
export async function duplicateScopeTemplate(id: number): Promise<ActionResult<{ templateId: number }>> {
  const source = await db().query.scopeGroupTemplates.findFirst({
    where: eq(schema.scopeGroupTemplates.id, id),
  });
  if (!source) return { ok: false, error: "Template not found" };

  const [{ maxOrder }] = await db()
    .select({ maxOrder: sql<number>`coalesce(max(${schema.scopeGroupTemplates.sortOrder}), 0)::int` })
    .from(schema.scopeGroupTemplates);

  const [tpl] = await db()
    .insert(schema.scopeGroupTemplates)
    .values({
      name: `${source.name} (copy)`,
      description: source.description,
      sortOrder: maxOrder + 1,
    })
    .returning({ id: schema.scopeGroupTemplates.id });

  const items = await db()
    .select()
    .from(schema.scopeGroupTemplateItems)
    .where(eq(schema.scopeGroupTemplateItems.templateId, id))
    .orderBy(asc(schema.scopeGroupTemplateItems.sortOrder));
  if (items.length > 0) {
    await db()
      .insert(schema.scopeGroupTemplateItems)
      .values(
        items.map((it) => ({
          templateId: tpl.id,
          name: it.name,
          category: it.category,
          isAlternate: it.isAlternate,
          location: it.location,
          productLink: it.productLink,
          pricingMethod: it.pricingMethod,
          unitPrice: it.unitPrice,
          defaultQuantity: it.defaultQuantity,
          quantityFormula: it.quantityFormula,
          costCodeRef: it.costCodeRef,
          laborAssumptions: it.laborAssumptions,
          materialAssumptions: it.materialAssumptions,
          notes: it.notes,
          active: it.active,
          sortOrder: it.sortOrder,
        })),
      );
  }
  revalidateTemplates();
  return { ok: true, templateId: tpl.id };
}

export async function archiveScopeTemplate(id: number): Promise<ActionResult> {
  await db()
    .update(schema.scopeGroupTemplates)
    .set({ archivedAt: new Date() })
    .where(eq(schema.scopeGroupTemplates.id, id));
  revalidateTemplates();
  return { ok: true };
}

export async function restoreScopeTemplate(id: number): Promise<ActionResult> {
  await db()
    .update(schema.scopeGroupTemplates)
    .set({ archivedAt: null })
    .where(eq(schema.scopeGroupTemplates.id, id));
  revalidateTemplates();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Template items
// ---------------------------------------------------------------------------

const itemSchema = z.object({
  templateId: z.coerce.number().int().positive(),
  name: z.string().trim().min(1, "A work description is required"),
  category: z.string().trim().optional(),
  isAlternate: z.boolean(),
  location: z.string().trim().optional(),
  productLink: z.string().trim().optional(),
  costCodeRef: z.string().trim().optional(),
  materialAssumptions: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

function parseItemForm(formData: FormData) {
  return {
    templateId: formData.get("templateId"),
    name: formData.get("name"),
    category: formData.get("category") || undefined,
    isAlternate: formData.get("isAlternate") === "on",
    location: formData.get("location") || undefined,
    productLink: formData.get("productLink") || undefined,
    costCodeRef: formData.get("costCodeRef") || undefined,
    materialAssumptions: formData.get("materialAssumptions") || undefined,
    notes: formData.get("notes") || undefined,
  };
}

export async function addTemplateItem(formData: FormData): Promise<ActionResult> {
  const parsed = itemSchema.safeParse(parseItemForm(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const d = parsed.data;

  const [{ maxOrder }] = await db()
    .select({ maxOrder: sql<number>`coalesce(max(${schema.scopeGroupTemplateItems.sortOrder}), 0)::int` })
    .from(schema.scopeGroupTemplateItems)
    .where(eq(schema.scopeGroupTemplateItems.templateId, d.templateId));

  await db().insert(schema.scopeGroupTemplateItems).values({
    templateId: d.templateId,
    name: d.name,
    category: d.category ?? null,
    isAlternate: d.isAlternate,
    location: d.location ?? null,
    productLink: d.productLink ?? null,
    costCodeRef: d.costCodeRef ?? null,
    materialAssumptions: d.materialAssumptions ?? null,
    notes: d.notes ?? null,
    sortOrder: maxOrder + 1,
  });
  revalidateTemplates(d.templateId);
  return { ok: true };
}

export async function updateTemplateItem(formData: FormData): Promise<ActionResult> {
  const idRaw = formData.get("id");
  const id = Number(idRaw);
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: "Invalid item" };

  const parsed = itemSchema.safeParse(parseItemForm(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const d = parsed.data;

  await db()
    .update(schema.scopeGroupTemplateItems)
    .set({
      name: d.name,
      category: d.category ?? null,
      isAlternate: d.isAlternate,
      location: d.location ?? null,
      productLink: d.productLink ?? null,
      costCodeRef: d.costCodeRef ?? null,
      materialAssumptions: d.materialAssumptions ?? null,
      notes: d.notes ?? null,
    })
    .where(eq(schema.scopeGroupTemplateItems.id, id));
  revalidateTemplates(d.templateId);
  return { ok: true };
}

export async function deleteTemplateItem(input: {
  id: number;
  templateId: number;
}): Promise<ActionResult> {
  await db()
    .delete(schema.scopeGroupTemplateItems)
    .where(eq(schema.scopeGroupTemplateItems.id, input.id));
  revalidateTemplates(input.templateId);
  return { ok: true };
}

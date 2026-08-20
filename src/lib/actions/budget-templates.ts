"use server";

import { revalidatePath } from "next/cache";
import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import type { ActionResult } from "@/lib/action-result";

// ---------------------------------------------------------------------------
// Budget templates — the portfolio library managed under Settings. These are
// the base options offered when creating a per-property budget group.
// ---------------------------------------------------------------------------

function revalidateTemplates(templateId?: number) {
  revalidatePath("/settings/renovation-types");
  if (templateId != null) revalidatePath(`/settings/renovation-types/${templateId}`);
}

const templateSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  description: z.string().trim().optional(),
});

export async function createBudgetTemplate(input: {
  name: string;
  description?: string;
}): Promise<ActionResult<{ templateId: number }>> {
  const parsed = templateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const [{ maxOrder }] = await db()
    .select({ maxOrder: sql<number>`coalesce(max(${schema.budgetTemplates.sortOrder}), 0)::int` })
    .from(schema.budgetTemplates);

  const [tpl] = await db()
    .insert(schema.budgetTemplates)
    .values({ name: parsed.data.name, description: parsed.data.description, sortOrder: maxOrder + 1 })
    .returning({ id: schema.budgetTemplates.id });
  revalidateTemplates();
  return { ok: true, templateId: tpl.id };
}

export async function updateBudgetTemplate(input: {
  id: number;
  name: string;
  description?: string;
}): Promise<ActionResult> {
  const parsed = templateSchema.safeParse({ name: input.name, description: input.description });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  await db()
    .update(schema.budgetTemplates)
    .set({ name: parsed.data.name, description: parsed.data.description ?? null })
    .where(eq(schema.budgetTemplates.id, input.id));
  revalidateTemplates(input.id);
  return { ok: true };
}

export async function duplicateBudgetTemplate(id: number): Promise<ActionResult<{ templateId: number }>> {
  const source = await db().query.budgetTemplates.findFirst({
    where: eq(schema.budgetTemplates.id, id),
  });
  if (!source) return { ok: false, error: "Template not found" };

  const [{ maxOrder }] = await db()
    .select({ maxOrder: sql<number>`coalesce(max(${schema.budgetTemplates.sortOrder}), 0)::int` })
    .from(schema.budgetTemplates);

  const [tpl] = await db()
    .insert(schema.budgetTemplates)
    .values({
      name: `${source.name} (copy)`,
      description: source.description,
      sortOrder: maxOrder + 1,
    })
    .returning({ id: schema.budgetTemplates.id });

  const lines = await db()
    .select()
    .from(schema.budgetTemplateLines)
    .where(eq(schema.budgetTemplateLines.templateId, id))
    .orderBy(asc(schema.budgetTemplateLines.sortOrder));
  if (lines.length > 0) {
    await db()
      .insert(schema.budgetTemplateLines)
      .values(
        lines.map((ln) => ({
          templateId: tpl.id,
          costCodeRef: ln.costCodeRef,
          pricingMethod: ln.pricingMethod,
          unitPrice: ln.unitPrice,
          defaultQuantity: ln.defaultQuantity,
          notes: ln.notes,
          sortOrder: ln.sortOrder,
        })),
      );
  }
  revalidateTemplates();
  return { ok: true, templateId: tpl.id };
}

export async function archiveBudgetTemplate(id: number): Promise<ActionResult> {
  await db()
    .update(schema.budgetTemplates)
    .set({ archivedAt: new Date() })
    .where(eq(schema.budgetTemplates.id, id));
  revalidateTemplates();
  return { ok: true };
}

export async function restoreBudgetTemplate(id: number): Promise<ActionResult> {
  await db()
    .update(schema.budgetTemplates)
    .set({ archivedAt: null })
    .where(eq(schema.budgetTemplates.id, id));
  revalidateTemplates();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Template lines (1:1 with cost codes)
// ---------------------------------------------------------------------------

const lineSchema = z.object({
  templateId: z.coerce.number().int().positive(),
  costCodeRef: z.string().trim().min(1, "Cost code is required"),
  pricingMethod: z.string().trim().optional(),
  unitPrice: z.coerce.number().nonnegative().optional(),
  defaultQuantity: z.coerce.number().nonnegative().optional(),
  notes: z.string().trim().optional(),
});

function parseLineForm(formData: FormData) {
  return {
    templateId: formData.get("templateId"),
    costCodeRef: formData.get("costCodeRef"),
    pricingMethod: formData.get("pricingMethod") || "fixed",
    unitPrice: formData.get("unitPrice") || undefined,
    defaultQuantity: formData.get("defaultQuantity") || undefined,
    notes: formData.get("notes") || undefined,
  };
}

export async function addTemplateLine(formData: FormData): Promise<ActionResult> {
  const parsed = lineSchema.safeParse(parseLineForm(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const d = parsed.data;

  const [{ maxOrder }] = await db()
    .select({ maxOrder: sql<number>`coalesce(max(${schema.budgetTemplateLines.sortOrder}), 0)::int` })
    .from(schema.budgetTemplateLines)
    .where(eq(schema.budgetTemplateLines.templateId, d.templateId));

  await db().insert(schema.budgetTemplateLines).values({
    templateId: d.templateId,
    costCodeRef: d.costCodeRef,
    pricingMethod: (d.pricingMethod as "fixed") ?? "fixed",
    unitPrice: (d.unitPrice ?? 0).toFixed(2),
    defaultQuantity: d.defaultQuantity != null ? d.defaultQuantity.toFixed(2) : null,
    notes: d.notes ?? null,
    sortOrder: maxOrder + 1,
  });
  revalidateTemplates(d.templateId);
  return { ok: true };
}

export async function updateTemplateLine(formData: FormData): Promise<ActionResult> {
  const idRaw = formData.get("id");
  const id = Number(idRaw);
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: "Invalid line" };

  const parsed = lineSchema.safeParse(parseLineForm(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const d = parsed.data;

  await db()
    .update(schema.budgetTemplateLines)
    .set({
      costCodeRef: d.costCodeRef,
      pricingMethod: (d.pricingMethod as "fixed") ?? "fixed",
      unitPrice: (d.unitPrice ?? 0).toFixed(2),
      defaultQuantity: d.defaultQuantity != null ? d.defaultQuantity.toFixed(2) : null,
      notes: d.notes ?? null,
    })
    .where(eq(schema.budgetTemplateLines.id, id));
  revalidateTemplates(d.templateId);
  return { ok: true };
}

export async function deleteTemplateLine(input: {
  id: number;
  templateId: number;
}): Promise<ActionResult> {
  await db()
    .delete(schema.budgetTemplateLines)
    .where(eq(schema.budgetTemplateLines.id, input.id));
  revalidateTemplates(input.templateId);
  return { ok: true };
}

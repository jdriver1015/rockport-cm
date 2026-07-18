"use server";

import { revalidatePath } from "next/cache";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import type { ActionResult } from "@/lib/action-result";
import { PRICING_METHODS } from "@/lib/pricing";

// ---------------------------------------------------------------------------
// Per-property scope groups — the usable renovation packages the interior
// wizard picks from. Created from a Settings template (items cloned, each
// costCodeRef resolved to this property's chart) or blank.
// ---------------------------------------------------------------------------

function revalidateGroups(propertyId: number) {
  revalidatePath(`/properties/${propertyId}/interiors`);
}

async function propertyChartId(propertyId: number): Promise<number | null> {
  const property = await db().query.properties.findFirst({
    where: eq(schema.properties.id, propertyId),
    columns: { chartOfAccountsId: true },
  });
  return property?.chartOfAccountsId ?? null;
}

/** Map 4000-series code strings → this chart's costCode ids (missing codes omitted). */
async function resolveCodeRefs(
  chartId: number,
  refs: (string | null)[],
): Promise<Map<string, number>> {
  const wanted = [...new Set(refs.filter((r): r is string => !!r))];
  if (wanted.length === 0) return new Map();
  const rows = await db()
    .select({ id: schema.costCodes.id, code: schema.costCodes.code })
    .from(schema.costCodes)
    .where(and(eq(schema.costCodes.chartId, chartId), inArray(schema.costCodes.code, wanted)));
  return new Map(rows.map((r) => [r.code, r.id]));
}

async function nextGroupOrder(propertyId: number): Promise<number> {
  const [{ maxOrder }] = await db()
    .select({ maxOrder: sql<number>`coalesce(max(${schema.scopeGroups.sortOrder}), 0)::int` })
    .from(schema.scopeGroups)
    .where(eq(schema.scopeGroups.propertyId, propertyId));
  return maxOrder + 1;
}

const groupSchema = z.object({
  propertyId: z.coerce.number().int().positive(),
  name: z.string().trim().min(1, "Name is required"),
  description: z.string().trim().optional(),
});

/** Create a scope group by cloning a Settings template into this property. */
export async function createGroupFromTemplate(input: {
  propertyId: number;
  templateId: number;
  name?: string;
}): Promise<ActionResult<{ groupId: number; unresolved: number }>> {
  const propertyId = Number(input.propertyId);
  const chartId = await propertyChartId(propertyId);
  if (chartId == null) return { ok: false, error: "Property not found" };

  const template = await db().query.scopeGroupTemplates.findFirst({
    where: eq(schema.scopeGroupTemplates.id, input.templateId),
  });
  if (!template) return { ok: false, error: "Template not found" };

  const items = await db()
    .select()
    .from(schema.scopeGroupTemplateItems)
    .where(eq(schema.scopeGroupTemplateItems.templateId, input.templateId))
    .orderBy(asc(schema.scopeGroupTemplateItems.sortOrder));

  const codeMap = await resolveCodeRefs(
    chartId,
    items.map((it) => it.costCodeRef),
  );

  const [group] = await db()
    .insert(schema.scopeGroups)
    .values({
      propertyId,
      name: input.name?.trim() || template.name,
      description: template.description,
      sourceTemplateId: template.id,
      sortOrder: await nextGroupOrder(propertyId),
    })
    .returning({ id: schema.scopeGroups.id });

  let unresolved = 0;
  if (items.length > 0) {
    await db().insert(schema.scopeGroupItems).values(
      items.map((it) => {
        const costCodeId = it.costCodeRef ? codeMap.get(it.costCodeRef) ?? null : null;
        if (it.costCodeRef && costCodeId == null) unresolved++;
        return {
          scopeGroupId: group.id,
          name: it.name,
          category: it.category,
          isAlternate: it.isAlternate,
          location: it.location,
          productLink: it.productLink,
          pricingMethod: it.pricingMethod,
          unitPrice: it.unitPrice,
          defaultQuantity: it.defaultQuantity,
          quantityFormula: it.quantityFormula,
          costCodeId,
          laborAssumptions: it.laborAssumptions,
          materialAssumptions: it.materialAssumptions,
          notes: it.notes,
          active: it.active,
          sortOrder: it.sortOrder,
        };
      }),
    );
  }

  revalidateGroups(propertyId);
  return { ok: true, groupId: group.id, unresolved };
}

export async function createBlankGroup(input: {
  propertyId: number;
  name: string;
  description?: string;
}): Promise<ActionResult<{ groupId: number }>> {
  const parsed = groupSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const [group] = await db()
    .insert(schema.scopeGroups)
    .values({
      propertyId: parsed.data.propertyId,
      name: parsed.data.name,
      description: parsed.data.description,
      sortOrder: await nextGroupOrder(parsed.data.propertyId),
    })
    .returning({ id: schema.scopeGroups.id });
  revalidateGroups(parsed.data.propertyId);
  return { ok: true, groupId: group.id };
}

export async function updateGroup(input: {
  id: number;
  propertyId: number;
  name: string;
  description?: string;
}): Promise<ActionResult> {
  const parsed = groupSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  await db()
    .update(schema.scopeGroups)
    .set({ name: parsed.data.name, description: parsed.data.description ?? null })
    .where(eq(schema.scopeGroups.id, input.id));
  revalidateGroups(parsed.data.propertyId);
  return { ok: true };
}

/** Deep-copy a group (and its items) within the same property. */
export async function duplicateGroup(input: {
  id: number;
  propertyId: number;
}): Promise<ActionResult<{ groupId: number }>> {
  const source = await db().query.scopeGroups.findFirst({
    where: eq(schema.scopeGroups.id, input.id),
  });
  if (!source) return { ok: false, error: "Scope group not found" };

  const [group] = await db()
    .insert(schema.scopeGroups)
    .values({
      propertyId: source.propertyId,
      name: `${source.name} (copy)`,
      description: source.description,
      sourceTemplateId: source.sourceTemplateId,
      sortOrder: await nextGroupOrder(source.propertyId),
    })
    .returning({ id: schema.scopeGroups.id });

  const items = await db()
    .select()
    .from(schema.scopeGroupItems)
    .where(eq(schema.scopeGroupItems.scopeGroupId, input.id))
    .orderBy(asc(schema.scopeGroupItems.sortOrder));
  if (items.length > 0) {
    await db().insert(schema.scopeGroupItems).values(
      items.map((it) => ({
        scopeGroupId: group.id,
        name: it.name,
        category: it.category,
        isAlternate: it.isAlternate,
        location: it.location,
        productLink: it.productLink,
        pricingMethod: it.pricingMethod,
        unitPrice: it.unitPrice,
        defaultQuantity: it.defaultQuantity,
        quantityFormula: it.quantityFormula,
        costCodeId: it.costCodeId,
        laborAssumptions: it.laborAssumptions,
        materialAssumptions: it.materialAssumptions,
        notes: it.notes,
        active: it.active,
        sortOrder: it.sortOrder,
      })),
    );
  }
  revalidateGroups(source.propertyId);
  return { ok: true, groupId: group.id };
}

export async function archiveGroup(input: { id: number; propertyId: number }): Promise<ActionResult> {
  await db()
    .update(schema.scopeGroups)
    .set({ archivedAt: new Date() })
    .where(eq(schema.scopeGroups.id, input.id));
  revalidateGroups(input.propertyId);
  return { ok: true };
}

export async function restoreGroup(input: { id: number; propertyId: number }): Promise<ActionResult> {
  await db()
    .update(schema.scopeGroups)
    .set({ archivedAt: null })
    .where(eq(schema.scopeGroups.id, input.id));
  revalidateGroups(input.propertyId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Group items
// ---------------------------------------------------------------------------

const itemSchema = z.object({
  propertyId: z.coerce.number().int().positive(),
  scopeGroupId: z.coerce.number().int().positive(),
  name: z.string().trim().min(1, "Name is required"),
  category: z.string().trim().optional(),
  isAlternate: z.boolean().optional(),
  location: z.string().trim().optional(),
  productLink: z.string().trim().optional(),
  pricingMethod: z.enum(PRICING_METHODS),
  unitPrice: z.coerce.number().nonnegative().optional(),
  defaultQuantity: z.coerce.number().nonnegative().optional(),
  quantityFormula: z.string().trim().optional(),
  costCodeId: z.coerce.number().int().positive().optional(),
  laborAssumptions: z.string().trim().optional(),
  materialAssumptions: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

function parseItemForm(formData: FormData) {
  return {
    propertyId: formData.get("propertyId"),
    scopeGroupId: formData.get("scopeGroupId"),
    name: formData.get("name"),
    category: formData.get("category") || undefined,
    isAlternate: formData.get("isAlternate") === "on",
    location: formData.get("location") || undefined,
    productLink: formData.get("productLink") || undefined,
    pricingMethod: formData.get("pricingMethod"),
    unitPrice: formData.get("unitPrice") || undefined,
    defaultQuantity: formData.get("defaultQuantity") || undefined,
    quantityFormula: formData.get("quantityFormula") || undefined,
    costCodeId: formData.get("costCodeId") || undefined,
    laborAssumptions: formData.get("laborAssumptions") || undefined,
    materialAssumptions: formData.get("materialAssumptions") || undefined,
    notes: formData.get("notes") || undefined,
  };
}

/** A chosen cost code must belong to this property's chart. */
async function validateCode(propertyId: number, costCodeId?: number): Promise<boolean> {
  if (costCodeId == null) return true;
  const chartId = await propertyChartId(propertyId);
  if (chartId == null) return false;
  const code = await db().query.costCodes.findFirst({
    where: eq(schema.costCodes.id, costCodeId),
    columns: { chartId: true },
  });
  return !!code && code.chartId === chartId;
}

export async function addGroupItem(formData: FormData): Promise<ActionResult> {
  const parsed = itemSchema.safeParse(parseItemForm(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const d = parsed.data;
  if (!(await validateCode(d.propertyId, d.costCodeId))) {
    return { ok: false, error: "That cost code isn't in this property's chart" };
  }

  const [{ maxOrder }] = await db()
    .select({ maxOrder: sql<number>`coalesce(max(${schema.scopeGroupItems.sortOrder}), 0)::int` })
    .from(schema.scopeGroupItems)
    .where(eq(schema.scopeGroupItems.scopeGroupId, d.scopeGroupId));

  await db().insert(schema.scopeGroupItems).values({
    scopeGroupId: d.scopeGroupId,
    name: d.name,
    category: d.category ?? null,
    isAlternate: d.isAlternate ?? false,
    location: d.location ?? null,
    productLink: d.productLink ?? null,
    pricingMethod: d.pricingMethod,
    unitPrice: (d.unitPrice ?? 0).toFixed(2),
    defaultQuantity: d.defaultQuantity != null ? d.defaultQuantity.toFixed(2) : null,
    quantityFormula: d.quantityFormula ?? null,
    costCodeId: d.costCodeId ?? null,
    laborAssumptions: d.laborAssumptions ?? null,
    materialAssumptions: d.materialAssumptions ?? null,
    notes: d.notes ?? null,
    sortOrder: maxOrder + 1,
  });
  revalidateGroups(d.propertyId);
  return { ok: true };
}

export async function updateGroupItem(formData: FormData): Promise<ActionResult> {
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: "Invalid item" };
  const parsed = itemSchema.safeParse(parseItemForm(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const d = parsed.data;
  if (!(await validateCode(d.propertyId, d.costCodeId))) {
    return { ok: false, error: "That cost code isn't in this property's chart" };
  }

  await db()
    .update(schema.scopeGroupItems)
    .set({
      name: d.name,
      category: d.category ?? null,
      isAlternate: d.isAlternate ?? false,
      location: d.location ?? null,
      productLink: d.productLink ?? null,
      pricingMethod: d.pricingMethod,
      unitPrice: (d.unitPrice ?? 0).toFixed(2),
      defaultQuantity: d.defaultQuantity != null ? d.defaultQuantity.toFixed(2) : null,
      quantityFormula: d.quantityFormula ?? null,
      costCodeId: d.costCodeId ?? null,
      laborAssumptions: d.laborAssumptions ?? null,
      materialAssumptions: d.materialAssumptions ?? null,
      notes: d.notes ?? null,
    })
    .where(eq(schema.scopeGroupItems.id, id));
  revalidateGroups(d.propertyId);
  return { ok: true };
}

export async function deleteGroupItem(input: {
  id: number;
  propertyId: number;
}): Promise<ActionResult> {
  await db().delete(schema.scopeGroupItems).where(eq(schema.scopeGroupItems.id, input.id));
  revalidateGroups(input.propertyId);
  return { ok: true };
}

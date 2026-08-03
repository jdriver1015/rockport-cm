"use server";

import { revalidatePath } from "next/cache";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import type { ActionResult } from "@/lib/action-result";
import { PRICING_METHODS } from "@/lib/pricing";
import { propertyPath } from "@/lib/property-path";

// ---------------------------------------------------------------------------
// Per-property budget groups — the usable renovation packages the interior
// wizard picks from. Created from a Settings template (lines cloned, each
// costCodeRef resolved to this property's chart) or blank.
// ---------------------------------------------------------------------------

async function revalidateGroups(propertyId: number) {
  const path = await propertyPath(propertyId, "/interiors");
  if (path) revalidatePath(path);
}

async function propertyChartId(propertyId: number): Promise<number | null> {
  const property = await db().query.properties.findFirst({
    where: eq(schema.properties.id, propertyId),
    columns: { chartOfAccountsId: true },
  });
  return property?.chartOfAccountsId ?? null;
}

async function resolveCodeRefs(
  chartId: number,
  refs: string[],
): Promise<Map<string, number>> {
  const wanted = [...new Set(refs.filter(Boolean))];
  if (wanted.length === 0) return new Map();
  const rows = await db()
    .select({ id: schema.costCodes.id, code: schema.costCodes.code })
    .from(schema.costCodes)
    .where(and(eq(schema.costCodes.chartId, chartId), inArray(schema.costCodes.code, wanted)));
  return new Map(rows.map((r) => [r.code, r.id]));
}

async function nextGroupOrder(propertyId: number): Promise<number> {
  const [{ maxOrder }] = await db()
    .select({ maxOrder: sql<number>`coalesce(max(${schema.budgetGroups.sortOrder}), 0)::int` })
    .from(schema.budgetGroups)
    .where(eq(schema.budgetGroups.propertyId, propertyId));
  return maxOrder + 1;
}

const groupSchema = z.object({
  propertyId: z.coerce.number().int().positive(),
  name: z.string().trim().min(1, "Name is required"),
  description: z.string().trim().optional(),
});

export async function createGroupFromTemplate(input: {
  propertyId: number;
  templateId: number;
  name?: string;
}): Promise<ActionResult<{ groupId: number; unresolved: number }>> {
  const propertyId = Number(input.propertyId);
  const chartId = await propertyChartId(propertyId);
  if (chartId == null) return { ok: false, error: "Property not found" };

  const template = await db().query.budgetTemplates.findFirst({
    where: eq(schema.budgetTemplates.id, input.templateId),
  });
  if (!template) return { ok: false, error: "Template not found" };

  const lines = await db()
    .select()
    .from(schema.budgetTemplateLines)
    .where(eq(schema.budgetTemplateLines.templateId, input.templateId))
    .orderBy(asc(schema.budgetTemplateLines.sortOrder));

  const codeMap = await resolveCodeRefs(
    chartId,
    lines.map((ln) => ln.costCodeRef),
  );

  const [group] = await db()
    .insert(schema.budgetGroups)
    .values({
      propertyId,
      name: input.name?.trim() || template.name,
      description: template.description,
      sourceTemplateId: template.id,
      sortOrder: await nextGroupOrder(propertyId),
    })
    .returning({ id: schema.budgetGroups.id });

  let unresolved = 0;
  const resolved = lines
    .map((ln) => {
      const costCodeId = codeMap.get(ln.costCodeRef);
      if (!costCodeId) {
        unresolved++;
        return null;
      }
      return {
        budgetGroupId: group.id,
        costCodeId,
        pricingMethod: ln.pricingMethod,
        unitPrice: ln.unitPrice,
        defaultQuantity: ln.defaultQuantity,
        notes: ln.notes,
        sortOrder: ln.sortOrder,
      };
    })
    .filter((v): v is NonNullable<typeof v> => v != null);

  if (resolved.length > 0) {
    await db().insert(schema.budgetGroupLines).values(resolved);
  }

  await revalidateGroups(propertyId);
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
    .insert(schema.budgetGroups)
    .values({
      propertyId: parsed.data.propertyId,
      name: parsed.data.name,
      description: parsed.data.description,
      sortOrder: await nextGroupOrder(parsed.data.propertyId),
    })
    .returning({ id: schema.budgetGroups.id });
  await revalidateGroups(parsed.data.propertyId);
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
    .update(schema.budgetGroups)
    .set({ name: parsed.data.name, description: parsed.data.description ?? null })
    .where(eq(schema.budgetGroups.id, input.id));
  await revalidateGroups(parsed.data.propertyId);
  return { ok: true };
}

export async function duplicateGroup(input: {
  id: number;
  propertyId: number;
}): Promise<ActionResult<{ groupId: number }>> {
  const source = await db().query.budgetGroups.findFirst({
    where: eq(schema.budgetGroups.id, input.id),
  });
  if (!source) return { ok: false, error: "Budget group not found" };

  const [group] = await db()
    .insert(schema.budgetGroups)
    .values({
      propertyId: source.propertyId,
      name: `${source.name} (copy)`,
      description: source.description,
      sourceTemplateId: source.sourceTemplateId,
      sortOrder: await nextGroupOrder(source.propertyId),
    })
    .returning({ id: schema.budgetGroups.id });

  const lines = await db()
    .select()
    .from(schema.budgetGroupLines)
    .where(eq(schema.budgetGroupLines.budgetGroupId, input.id))
    .orderBy(asc(schema.budgetGroupLines.sortOrder));
  if (lines.length > 0) {
    await db().insert(schema.budgetGroupLines).values(
      lines.map((ln) => ({
        budgetGroupId: group.id,
        costCodeId: ln.costCodeId,
        pricingMethod: ln.pricingMethod,
        unitPrice: ln.unitPrice,
        defaultQuantity: ln.defaultQuantity,
        notes: ln.notes,
        sortOrder: ln.sortOrder,
      })),
    );
  }
  await revalidateGroups(source.propertyId);
  return { ok: true, groupId: group.id };
}

export async function archiveGroup(input: { id: number; propertyId: number }): Promise<ActionResult> {
  await db()
    .update(schema.budgetGroups)
    .set({ archivedAt: new Date() })
    .where(eq(schema.budgetGroups.id, input.id));
  await revalidateGroups(input.propertyId);
  return { ok: true };
}

export async function restoreGroup(input: { id: number; propertyId: number }): Promise<ActionResult> {
  await db()
    .update(schema.budgetGroups)
    .set({ archivedAt: null })
    .where(eq(schema.budgetGroups.id, input.id));
  await revalidateGroups(input.propertyId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Group lines (1:1 with cost codes)
// ---------------------------------------------------------------------------

const lineSchema = z.object({
  propertyId: z.coerce.number().int().positive(),
  budgetGroupId: z.coerce.number().int().positive(),
  pricingMethod: z.enum(PRICING_METHODS),
  unitPrice: z.coerce.number().nonnegative().optional(),
  defaultQuantity: z.coerce.number().nonnegative().optional(),
  costCodeId: z.coerce.number().int().positive(),
  notes: z.string().trim().optional(),
});

function parseLineForm(formData: FormData) {
  return {
    propertyId: formData.get("propertyId"),
    budgetGroupId: formData.get("budgetGroupId"),
    pricingMethod: formData.get("pricingMethod"),
    unitPrice: formData.get("unitPrice") || undefined,
    defaultQuantity: formData.get("defaultQuantity") || undefined,
    costCodeId: formData.get("costCodeId"),
    notes: formData.get("notes") || undefined,
  };
}

async function validateCode(propertyId: number, costCodeId: number): Promise<boolean> {
  const chartId = await propertyChartId(propertyId);
  if (chartId == null) return false;
  const code = await db().query.costCodes.findFirst({
    where: eq(schema.costCodes.id, costCodeId),
    columns: { chartId: true },
  });
  return !!code && code.chartId === chartId;
}

export async function addGroupLine(formData: FormData): Promise<ActionResult> {
  const parsed = lineSchema.safeParse(parseLineForm(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const d = parsed.data;
  if (!(await validateCode(d.propertyId, d.costCodeId))) {
    return { ok: false, error: "That cost code isn't in this property's chart" };
  }

  const [{ maxOrder }] = await db()
    .select({ maxOrder: sql<number>`coalesce(max(${schema.budgetGroupLines.sortOrder}), 0)::int` })
    .from(schema.budgetGroupLines)
    .where(eq(schema.budgetGroupLines.budgetGroupId, d.budgetGroupId));

  await db().insert(schema.budgetGroupLines).values({
    budgetGroupId: d.budgetGroupId,
    costCodeId: d.costCodeId,
    pricingMethod: d.pricingMethod,
    unitPrice: (d.unitPrice ?? 0).toFixed(2),
    defaultQuantity: d.defaultQuantity != null ? d.defaultQuantity.toFixed(2) : null,
    notes: d.notes ?? null,
    sortOrder: maxOrder + 1,
  });
  await revalidateGroups(d.propertyId);
  return { ok: true };
}

export async function updateGroupLine(formData: FormData): Promise<ActionResult> {
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: "Invalid line" };
  const parsed = lineSchema.safeParse(parseLineForm(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const d = parsed.data;
  if (!(await validateCode(d.propertyId, d.costCodeId))) {
    return { ok: false, error: "That cost code isn't in this property's chart" };
  }

  await db()
    .update(schema.budgetGroupLines)
    .set({
      costCodeId: d.costCodeId,
      pricingMethod: d.pricingMethod,
      unitPrice: (d.unitPrice ?? 0).toFixed(2),
      defaultQuantity: d.defaultQuantity != null ? d.defaultQuantity.toFixed(2) : null,
      notes: d.notes ?? null,
    })
    .where(eq(schema.budgetGroupLines.id, id));
  await revalidateGroups(d.propertyId);
  return { ok: true };
}

export async function deleteGroupLine(input: {
  id: number;
  propertyId: number;
}): Promise<ActionResult> {
  await db().delete(schema.budgetGroupLines).where(eq(schema.budgetGroupLines.id, input.id));
  await revalidateGroups(input.propertyId);
  return { ok: true };
}

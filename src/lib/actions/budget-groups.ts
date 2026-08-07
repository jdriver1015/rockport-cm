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
}): Promise<ActionResult<{ groupId: number; overridesCopied: number }>> {
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
        description: ln.description,
        notes: ln.notes,
        sortOrder: ln.sortOrder,
      })),
    );
  }

  // Carry custom overrides across too — losing negotiated prices silently would
  // be quiet data loss.
  const existingOverrides = await db()
    .select()
    .from(schema.interiorBudgetLineOverrides)
    .where(eq(schema.interiorBudgetLineOverrides.budgetGroupId, input.id));
  if (existingOverrides.length > 0) {
    await db().insert(schema.interiorBudgetLineOverrides).values(
      existingOverrides.map((p) => ({
        propertyId: p.propertyId,
        budgetGroupId: group.id,
        costCodeId: p.costCodeId,
        unitGroupId: p.unitGroupId,
        amount: p.amount,
        note: p.note,
        createdBy: p.createdBy,
      })),
    );
  }

  await revalidateGroups(source.propertyId);
  return { ok: true, groupId: group.id, overridesCopied: existingOverrides.length };
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

/**
 * Set a tier's price for one cost code, addressed by (tier, cost code) rather
 * than line id so the budget pivot can call it straight from a cell.
 *
 * This is the *common* edit — it moves every unit group's cell for that row.
 * Custom overrides deliberately survive and keep winning; the pivot warns
 * when a row is overridden everywhere so a price change with no visible effect
 * is explainable.
 */
export async function setTierLinePrice(input: {
  propertyId: number;
  budgetGroupId: number;
  costCodeId: number;
  unitPrice: number;
}): Promise<ActionResult<{ overriddenCells: number }>> {
  const propertyId = Number(input.propertyId);
  const budgetGroupId = Number(input.budgetGroupId);
  const costCodeId = Number(input.costCodeId);
  const unitPrice = Number(input.unitPrice);
  if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    return { ok: false, error: "Price must be zero or more" };
  }

  const tier = await db().query.budgetGroups.findFirst({
    where: eq(schema.budgetGroups.id, budgetGroupId),
    columns: { propertyId: true },
  });
  if (!tier || tier.propertyId !== propertyId) {
    return { ok: false, error: "Upgrade tier not found for this property" };
  }

  const line = await db().query.budgetGroupLines.findFirst({
    where: and(
      eq(schema.budgetGroupLines.budgetGroupId, budgetGroupId),
      eq(schema.budgetGroupLines.costCodeId, costCodeId),
    ),
    columns: { id: true },
  });
  if (!line) return { ok: false, error: "That tier has no line for this cost code" };

  await db()
    .update(schema.budgetGroupLines)
    .set({ unitPrice: unitPrice.toFixed(2) })
    .where(eq(schema.budgetGroupLines.id, line.id));

  const [{ overriddenCells }] = await db()
    .select({ overriddenCells: sql<number>`count(*)::int` })
    .from(schema.interiorBudgetLineOverrides)
    .where(
      and(
        eq(schema.interiorBudgetLineOverrides.budgetGroupId, budgetGroupId),
        eq(schema.interiorBudgetLineOverrides.costCodeId, costCodeId),
      ),
    );

  await revalidateGroups(propertyId);
  const budgetPath = await propertyPath(propertyId, "/budget");
  if (budgetPath) revalidatePath(budgetPath);
  return { ok: true, overriddenCells };
}

const tierDefaultsSchema = z.object({
  propertyId: z.coerce.number().int().positive(),
  budgetGroupId: z.coerce.number().int().positive(),
  lines: z
    .array(
      z.object({
        costCodeId: z.coerce.number().int().positive(),
        /**
         * Only the two bases the inline editor offers. A line using one of the
         * other pricing methods is shown read-only there and never round-trips
         * through here, so an exotic method can't be flattened to `fixed` by
         * someone editing an unrelated row.
         */
        pricingMethod: z.enum(["fixed", "sqft"]),
        unitPrice: z.coerce.number().nonnegative("Price must be zero or more"),
      }),
    )
    .min(1, "Nothing to save"),
});

/**
 * Save a renovation type's default pricing in one pass — the amount and the
 * fixed-vs-per-square-foot basis for each of its cost codes.
 *
 * These defaults flow to every floorplan planned into the type EXCEPT cells with
 * a custom override, which are per-cell negotiated amounts and deliberately
 * immune. The returned `overriddenCells` count lets the caller say so, rather
 * than leaving an edit looking like it did nothing.
 */
export async function updateTierDefaults(
  input: z.input<typeof tierDefaultsSchema>,
): Promise<ActionResult<{ updated: number; overriddenCells: number }>> {
  const parsed = tierDefaultsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const d = parsed.data;

  const tier = await db().query.budgetGroups.findFirst({
    where: eq(schema.budgetGroups.id, d.budgetGroupId),
    columns: { propertyId: true },
  });
  if (!tier || tier.propertyId !== d.propertyId) {
    return { ok: false, error: "Renovation type not found for this property" };
  }

  const existing = await db()
    .select({ id: schema.budgetGroupLines.id, costCodeId: schema.budgetGroupLines.costCodeId })
    .from(schema.budgetGroupLines)
    .where(eq(schema.budgetGroupLines.budgetGroupId, d.budgetGroupId));
  const idByCode = new Map(existing.map((l) => [l.costCodeId, l.id]));

  const unknown = d.lines.filter((l) => !idByCode.has(l.costCodeId));
  if (unknown.length > 0) {
    return { ok: false, error: "A line no longer exists on this renovation type — reload and retry." };
  }

  await db().transaction(async (tx) => {
    for (const l of d.lines) {
      await tx
        .update(schema.budgetGroupLines)
        .set({ pricingMethod: l.pricingMethod, unitPrice: l.unitPrice.toFixed(2) })
        .where(eq(schema.budgetGroupLines.id, idByCode.get(l.costCodeId)!));
    }
  });

  const [{ overriddenCells }] = await db()
    .select({ overriddenCells: sql<number>`count(*)::int` })
    .from(schema.interiorBudgetLineOverrides)
    .where(
      and(
        eq(schema.interiorBudgetLineOverrides.budgetGroupId, d.budgetGroupId),
        inArray(
          schema.interiorBudgetLineOverrides.costCodeId,
          d.lines.map((l) => l.costCodeId),
        ),
      ),
    );

  await revalidateGroups(d.propertyId);
  const budgetPath = await propertyPath(d.propertyId, "/budget");
  if (budgetPath) revalidatePath(budgetPath);
  return { ok: true, updated: d.lines.length, overriddenCells };
}

export async function deleteGroupLine(input: {
  id: number;
  propertyId: number;
  confirm?: boolean;
}): Promise<ActionResult> {
  const line = await db().query.budgetGroupLines.findFirst({
    where: eq(schema.budgetGroupLines.id, Number(input.id)),
    columns: { id: true, budgetGroupId: true, costCodeId: true },
  });
  if (!line) return { ok: false, error: "Budget line not found" };

  const [{ overrideCount }] = await db()
    .select({ overrideCount: sql<number>`count(*)::int` })
    .from(schema.interiorBudgetLineOverrides)
    .where(
      and(
        eq(schema.interiorBudgetLineOverrides.budgetGroupId, line.budgetGroupId),
        eq(schema.interiorBudgetLineOverrides.costCodeId, line.costCodeId),
      ),
    );

  if (overrideCount > 0 && !input.confirm) {
    return {
      ok: false,
      error: `This line has ${overrideCount} custom override${overrideCount === 1 ? "" : "s"} in the interior budget. Removing the line leaves them orphaned — they'd reapply if this cost code is added back. Confirm to remove both.`,
    };
  }

  await db().transaction(async (tx) => {
    if (overrideCount > 0) {
      await tx
        .delete(schema.interiorBudgetLineOverrides)
        .where(
          and(
            eq(schema.interiorBudgetLineOverrides.budgetGroupId, line.budgetGroupId),
            eq(schema.interiorBudgetLineOverrides.costCodeId, line.costCodeId),
          ),
        );
    }
    await tx.delete(schema.budgetGroupLines).where(eq(schema.budgetGroupLines.id, line.id));
  });

  await revalidateGroups(input.propertyId);
  return { ok: true };
}

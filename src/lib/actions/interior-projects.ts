"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import type { ActionResult } from "@/lib/action-result";
import { PRICING_METHODS, roundMoney } from "@/lib/pricing";

// ---------------------------------------------------------------------------
// Interior project creation — the wizard's final step. Snapshots the reviewed,
// priced scope lines onto a new kind='unit' project and seeds its budgetAmount
// from their sum. Line totals stay derived (quantity × unitPrice).
// ---------------------------------------------------------------------------

const lineSchema = z.object({
  name: z.string().trim().min(1),
  category: z.string().trim().optional().nullable(),
  pricingMethod: z.enum(PRICING_METHODS),
  unitPrice: z.coerce.number().nonnegative(),
  quantity: z.coerce.number(),
  costCodeId: z.coerce.number().int().positive().optional().nullable(),
  sourceGroupItemId: z.coerce.number().int().positive().optional().nullable(),
  materialAssumptions: z.string().trim().optional().nullable(),
});

const optDate = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : null));

const createSchema = z.object({
  propertyId: z.coerce.number().int().positive(),
  scopeGroupId: z.coerce.number().int().positive(),
  unitNumber: z.string().trim().min(1, "Select a unit"),
  floorplan: z.string().trim().optional().nullable(),
  bedrooms: z.coerce.number().int().nonnegative().optional().nullable(),
  baths: z.coerce.number().nonnegative().optional().nullable(),
  sqft: z.coerce.number().int().nonnegative().optional().nullable(),
  vendorId: z.coerce.number().int().positive().optional().nullable(),
  name: z.string().trim().optional(),
  preWalkDate: optDate,
  startDate: optDate,
  targetCompletionDate: optDate,
  lines: z.array(lineSchema).min(1, "Add at least one scope item"),
});

export async function createInteriorProject(
  input: z.input<typeof createSchema>,
): Promise<ActionResult<{ projectId: number }>> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const d = parsed.data;

  const property = await db().query.properties.findFirst({
    where: eq(schema.properties.id, d.propertyId),
    columns: { id: true, chartOfAccountsId: true },
  });
  if (!property) return { ok: false, error: "Property not found" };

  const group = await db().query.scopeGroups.findFirst({
    where: eq(schema.scopeGroups.id, d.scopeGroupId),
  });
  if (!group || group.propertyId !== d.propertyId) {
    return { ok: false, error: "Scope group not found for this property" };
  }

  // Validate every referenced cost code belongs to this property's chart.
  const codeIds = [...new Set(d.lines.map((l) => l.costCodeId).filter((c): c is number => !!c))];
  if (codeIds.length > 0) {
    const valid = await db()
      .select({ id: schema.costCodes.id })
      .from(schema.costCodes)
      .where(and(eq(schema.costCodes.chartId, property.chartOfAccountsId), inArray(schema.costCodes.id, codeIds)));
    if (valid.length !== codeIds.length) {
      return { ok: false, error: "A scope line references a code outside this property's chart" };
    }
  }

  // Budget is the sum of the reviewed line totals, computed server-side.
  const budget = roundMoney(
    d.lines.reduce((sum, l) => sum + roundMoney(l.quantity * l.unitPrice), 0),
  );

  const result = await db().transaction(async (tx) => {
    // Upsert the unit inventory row and refresh its metadata from the rent roll.
    const existing = await tx.query.units.findFirst({
      where: and(eq(schema.units.propertyId, d.propertyId), eq(schema.units.unitNumber, d.unitNumber)),
    });
    const meta = {
      floorplan: d.floorplan ?? undefined,
      bedrooms: d.bedrooms ?? undefined,
      baths: d.baths != null ? d.baths.toFixed(1) : undefined,
      sqft: d.sqft ?? undefined,
    };
    let unitId: number;
    if (existing) {
      unitId = existing.id;
      await tx.update(schema.units).set(meta).where(eq(schema.units.id, existing.id));
    } else {
      const [unit] = await tx
        .insert(schema.units)
        .values({ propertyId: d.propertyId, unitNumber: d.unitNumber, ...meta })
        .returning({ id: schema.units.id });
      unitId = unit.id;
    }

    const [project] = await tx
      .insert(schema.projects)
      .values({
        propertyId: d.propertyId,
        kind: "unit",
        name: d.name?.trim() || `Unit ${d.unitNumber} Interior`,
        unitId,
        vendorId: d.vendorId ?? undefined,
        budgetAmount: budget.toFixed(2),
        preWalkDate: d.preWalkDate,
        startDate: d.startDate,
        targetCompletionDate: d.targetCompletionDate,
      })
      .returning({ id: schema.projects.id });

    if (d.lines.length > 0) {
      await tx.insert(schema.scopeItems).values(
        d.lines.map((l, i) => ({
          projectId: project.id,
          item: l.name,
          materialQuality: l.materialAssumptions ?? null,
          costCodeId: l.costCodeId ?? null,
          pricingMethod: l.pricingMethod,
          unitPrice: l.unitPrice.toFixed(2),
          quantity: l.quantity.toFixed(2),
          sourceGroupItemId: l.sourceGroupItemId ?? null,
          sortOrder: i,
        })),
      );
    }

    await tx.insert(schema.projectStageEvents).values({
      projectId: project.id,
      toStage: "planned",
      note: `Created from scope group "${group.name}"`,
    });

    return { projectId: project.id };
  });

  revalidatePath(`/properties/${d.propertyId}/interiors`);
  revalidatePath(`/properties/${d.propertyId}`);
  revalidatePath(`/properties/${d.propertyId}/budget`);
  return { ok: true, projectId: result.projectId };
}

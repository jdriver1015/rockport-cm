"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import type { ActionResult } from "@/lib/action-result";
import { PRICING_METHODS, roundMoney } from "@/lib/pricing";
import { propertyPath } from "@/lib/property-path";
import { defaultMilestoneRows } from "@/lib/milestones";
import { projectSlug } from "@/lib/slug";

// ---------------------------------------------------------------------------
// Interior project creation — the wizard's final step. Snapshots the reviewed,
// priced budget lines onto a new kind='unit' project and seeds its budgetAmount
// from their sum. Line totals stay derived (quantity × unitPrice).
// ---------------------------------------------------------------------------

const lineSchema = z.object({
  item: z.string().trim().min(1),
  category: z.string().trim().optional().nullable(),
  pricingMethod: z.enum(PRICING_METHODS),
  unitPrice: z.coerce.number().nonnegative(),
  quantity: z.coerce.number(),
  costCodeId: z.coerce.number().int().positive(),
  sourceBudgetLineId: z.coerce.number().int().positive().optional().nullable(),
  notes: z.string().trim().optional().nullable(),
});

const optDate = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : null));

const createSchema = z.object({
  propertyId: z.coerce.number().int().positive(),
  budgetGroupId: z.coerce.number().int().positive(),
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
  /**
   * Planned dates for the four seeded milestones, keyed by phase. Optional so
   * an older caller still creates a project with undated milestones rather than
   * none.
   */
  milestones: z
    .array(z.object({ phase: z.string().trim().min(1), plannedDate: optDate }))
    .optional(),
  lines: z.array(lineSchema).min(1, "Add at least one budget line"),
});

export async function createInteriorProject(
  input: z.input<typeof createSchema>,
): Promise<ActionResult<{ projectId: number; slug: string }>> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const d = parsed.data;

  const property = await db().query.properties.findFirst({
    where: eq(schema.properties.id, d.propertyId),
    columns: { id: true, chartOfAccountsId: true },
  });
  if (!property) return { ok: false, error: "Property not found" };

  const group = await db().query.budgetGroups.findFirst({
    where: eq(schema.budgetGroups.id, d.budgetGroupId),
  });
  if (!group || group.propertyId !== d.propertyId) {
    return { ok: false, error: "Budget group not found for this property" };
  }

  const codeIds = [...new Set(d.lines.map((l) => l.costCodeId))];
  if (codeIds.length > 0) {
    const valid = await db()
      .select({ id: schema.costCodes.id })
      .from(schema.costCodes)
      .where(and(eq(schema.costCodes.chartId, property.chartOfAccountsId), inArray(schema.costCodes.id, codeIds)));
    if (valid.length !== codeIds.length) {
      return { ok: false, error: "A budget line references a code outside this property's chart" };
    }
  }

  const budget = roundMoney(
    d.lines.reduce((sum, l) => sum + roundMoney(l.quantity * l.unitPrice), 0),
  );

  const result = await db().transaction(async (tx) => {
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

    const projectName = d.name?.trim() || `Unit ${d.unitNumber} Interior`;
    const [project] = await tx
      .insert(schema.projects)
      .values({
        propertyId: d.propertyId,
        kind: "unit",
        name: projectName,
        unitId,
        vendorId: d.vendorId ?? undefined,
        budgetGroupId: d.budgetGroupId,
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
          item: l.item,
          materialQuality: l.notes ?? null,
          category: l.category ?? null,
          costCodeId: l.costCodeId,
          pricingMethod: l.pricingMethod,
          unitPrice: l.unitPrice.toFixed(2),
          quantity: l.quantity.toFixed(2),
          sourceBudgetLineId: l.sourceBudgetLineId ?? null,
          sortOrder: i,
        })),
      );
    }

    await tx.insert(schema.projectStageEvents).values({
      projectId: project.id,
      toStage: "planned",
      toPhase: "precon",
      note: `Created from budget group "${group.name}"`,
    });

    // Unit turns run the same four phases as common-area work, so they get the
    // same seeded milestones.
    // Planned dates come from the wizard's schedule step; a phase the caller
    // didn't send stays undated rather than guessing here, so the suggestion
    // lives in exactly one place.
    const plannedByPhase = new Map(
      (d.milestones ?? []).map((m) => [m.phase, m.plannedDate]),
    );
    await tx.insert(schema.projectMilestones).values(
      defaultMilestoneRows(project.id).map((row) => ({
        ...row,
        plannedDate: plannedByPhase.get(row.phase) ?? null,
      })),
    );

    return { projectId: project.id, projectName };
  });

  const base = await propertyPath(d.propertyId);
  if (base) {
    revalidatePath(`${base}/interiors`);
    revalidatePath(base);
    revalidatePath(`${base}/budget`);
  }
  return {
    ok: true,
    projectId: result.projectId,
    slug: projectSlug({ id: result.projectId, name: result.projectName }),
  };
}

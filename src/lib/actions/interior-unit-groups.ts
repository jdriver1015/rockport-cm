"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import type { ActionResult } from "@/lib/action-result";
import { propertyPath } from "@/lib/property-path";

// ---------------------------------------------------------------------------
// Unit groups — the interior budget pivot's columns, one per rent-roll floorplan.
//
// No longer user-managed: a group is created on demand by `addUnitRenovation`
// when a floorplan is first planned, so a property only carries the floorplans
// someone actually intends to renovate. What's left here edits a group that
// already exists.
// ---------------------------------------------------------------------------

async function revalidateBudget(propertyId: number) {
  const path = await propertyPath(propertyId, "/budget");
  if (path) revalidatePath(path);
}

const updateSchema = z.object({
  id: z.coerce.number().int().positive(),
  propertyId: z.coerce.number().int().positive(),
  name: z.string().trim().min(1, "Name is required"),
  bedrooms: z.coerce.number().int().nonnegative().optional().nullable(),
  baths: z.coerce.number().nonnegative().optional().nullable(),
  /** Blank clears the override and returns the figure to rent-roll derivation. */
  unitCountOverride: z.coerce.number().int().nonnegative().optional().nullable(),
  avgSqftOverride: z.coerce.number().nonnegative().optional().nullable(),
});

export async function updateUnitGroup(
  input: z.input<typeof updateSchema>,
): Promise<ActionResult> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const d = parsed.data;

  const group = await db().query.interiorUnitGroups.findFirst({
    where: eq(schema.interiorUnitGroups.id, d.id),
  });
  if (!group || group.propertyId !== d.propertyId) {
    return { ok: false, error: "Unit group not found for this property" };
  }

  await db()
    .update(schema.interiorUnitGroups)
    .set({
      name: d.name,
      bedrooms: d.bedrooms ?? null,
      baths: d.baths != null ? d.baths.toFixed(1) : null,
      unitCountOverride: d.unitCountOverride ?? null,
      avgSqftOverride: d.avgSqftOverride != null ? d.avgSqftOverride.toFixed(2) : null,
    })
    .where(eq(schema.interiorUnitGroups.id, d.id));

  await revalidateBudget(d.propertyId);
  return { ok: true };
}

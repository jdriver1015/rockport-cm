"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import type { ActionResult } from "@/lib/action-result";
import { DEFAULTS_ID } from "@/lib/interior-defaults";

// ---------------------------------------------------------------------------
// Portfolio interior defaults — what a NEW property starts with: which
// renovation types it inherits, and the uplift settings it opens on.
//
// Nothing carried these across before, which is why three of five properties
// have no renovation types at all: each had to be rebuilt by hand.
// ---------------------------------------------------------------------------

const defaultsSchema = z.object({
  cmSupervisionPct: z.coerce.number().min(0).max(100),
  contingencyPct: z.coerce.number().min(0).max(100),
  cmEnabled: z.coerce.boolean(),
  contingencyEnabled: z.coerce.boolean(),
  cmCostCodeRef: z.string().trim().max(40).optional().nullable(),
  contingencyCostCodeRef: z.string().trim().max(40).optional().nullable(),
});

/**
 * Set the portfolio defaults. Applies to properties created from here on —
 * existing properties keep their own settings, which is the point of having
 * both levels.
 *
 * Mirrors the per-property guard in updateInteriorSettings: an uplift switched
 * on with a rate must name a cost code, or every property seeded from these
 * defaults starts with uplift dollars outside the cost-code tree.
 */
export async function updateInteriorDefaults(
  input: z.input<typeof defaultsSchema>,
): Promise<ActionResult> {
  const parsed = defaultsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const d = parsed.data;

  const cmRef = d.cmCostCodeRef?.trim() || null;
  const contRef = d.contingencyCostCodeRef?.trim() || null;

  for (const [label, ref, enabled, pct] of [
    ["CM / supervision", cmRef, d.cmEnabled, d.cmSupervisionPct],
    ["Contingency", contRef, d.contingencyEnabled, d.contingencyPct],
  ] as const) {
    if (ref == null && enabled && pct > 0) {
      return {
        ok: false,
        error: `${label} needs a cost code, or new properties will start with dollars that don't reconcile`,
      };
    }
  }

  await db()
    .insert(schema.interiorDefaultSettings)
    .values({
      id: DEFAULTS_ID,
      cmSupervisionPct: d.cmSupervisionPct.toFixed(3),
      contingencyPct: d.contingencyPct.toFixed(3),
      cmEnabled: d.cmEnabled,
      contingencyEnabled: d.contingencyEnabled,
      cmCostCodeRef: cmRef,
      contingencyCostCodeRef: contRef,
    })
    .onConflictDoUpdate({
      target: schema.interiorDefaultSettings.id,
      set: {
        cmSupervisionPct: d.cmSupervisionPct.toFixed(3),
        contingencyPct: d.contingencyPct.toFixed(3),
        cmEnabled: d.cmEnabled,
        contingencyEnabled: d.contingencyEnabled,
        cmCostCodeRef: cmRef,
        contingencyCostCodeRef: contRef,
        updatedAt: new Date(),
      },
    });

  revalidatePath("/settings/renovation-types");
  return { ok: true };
}

const seedFlagSchema = z.object({
  templateId: z.coerce.number().int().positive(),
  seedByDefault: z.coerce.boolean(),
});

/** Toggle whether a renovation type is pre-checked when a property is created. */
export async function setTemplateSeedDefault(
  input: z.input<typeof seedFlagSchema>,
): Promise<ActionResult> {
  const parsed = seedFlagSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const [row] = await db()
    .update(schema.budgetTemplates)
    .set({ seedByDefault: parsed.data.seedByDefault })
    .where(eq(schema.budgetTemplates.id, parsed.data.templateId))
    .returning({ id: schema.budgetTemplates.id });
  if (!row) return { ok: false, error: "Renovation type not found" };

  revalidatePath("/settings/renovation-types");
  revalidatePath("/properties/new");
  return { ok: true };
}


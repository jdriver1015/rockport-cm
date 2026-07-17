"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import type { ActionResult } from "@/lib/action-result";
import { parseRentRoll } from "@/lib/rent-roll-import";
import {
  downloadStoredFile,
  loadFormatMemory,
  loadPastExamples,
  replaceUnits,
  saveFormatMemory,
  saveMappingExamples,
} from "@/lib/rent-roll-pipeline";
import { validateRentRoll } from "@/lib/rent-roll-validation";
import type { AiMapping } from "@/lib/rent-roll-mapping";

function revalidateProperty(propertyId: number) {
  revalidatePath(`/properties/${propertyId}/rent-rolls`);
  revalidatePath(`/properties/${propertyId}`);
}

const round2 = (n: number): string => (Math.round(n * 100) / 100).toString();

/**
 * Parse (or re-parse) a rent-roll batch: download the stored file, run the
 * three-tier engine (or PDF extraction), materialize units, score the result,
 * and land the batch in `needs_review`. Used for both the initial parse and
 * user-driven AI re-parses (with free-text `instructions`).
 */
export async function parseBatch(batchId: number, instructions?: string): Promise<ActionResult> {
  const batch = await db().query.rentRollBatches.findFirst({
    where: eq(schema.rentRollBatches.id, batchId),
  });
  if (!batch) return { ok: false, error: "Rent roll not found" };
  if (!batch.storagePath) {
    return { ok: false, error: "Original file is missing — re-upload the rent roll" };
  }
  if (batch.status === "committed") {
    return { ok: false, error: "This rent roll is committed — delete it to re-import" };
  }

  const property = await db().query.properties.findFirst({
    where: eq(schema.properties.id, batch.propertyId),
  });

  await db()
    .update(schema.rentRollBatches)
    .set({
      status: "parsing",
      parseAttempts: batch.parseAttempts + 1,
      parseProgress: { stage: "parsing", pct: 20 },
      errorMessage: null,
    })
    .where(eq(schema.rentRollBatches.id, batchId));

  try {
    const buf = await downloadStoredFile(batch.storagePath);
    const [formatMemory, pastExamples] = await Promise.all([
      loadFormatMemory(),
      loadPastExamples(),
    ]);

    const result = await parseRentRoll(buf, {
      formatMemory,
      pastExamples,
      instructions: instructions?.trim() || undefined,
    });

    if (result.units.length === 0) {
      throw new Error("No unit rows detected — try re-parsing with a correction note.");
    }

    await replaceUnits(batch.propertyId, batchId, result.units, result.rowFlags);

    const { score, failures } = validateRentRoll(
      { units: result.units, stats: result.stats },
      { unitCount: property?.unitCount ?? null },
    );

    const lossToLeaseDollars = result.stats.total_market_rent - result.stats.total_in_place_rent;

    await db()
      .update(schema.rentRollBatches)
      .set({
        status: "needs_review",
        asOfDate: result.asOfDate,
        rowCount: result.units.length,
        occupiedCount: result.stats.occupied,
        vacantCount: result.stats.vacant,
        noticeCount: result.stats.notice,
        occupancyPct: round2(result.stats.occupancy * 100),
        totalMarketRent: round2(result.stats.total_market_rent),
        totalInPlaceRent: round2(result.stats.total_in_place_rent),
        lossToLease: round2(lossToLeaseDollars),
        parseMethod: result.parseMethod,
        confidenceScore: score,
        warnings: result.warnings,
        extractedMeta: {
          floorplans: result.floorplans,
          stats: result.stats,
          mapping: result.mapping,
          rowFlags: result.rowFlags,
          rawSheet: result.rawSheet,
          fingerprint: result.fingerprint,
          headerLabels: result.headerLabels,
          sourceSystem: batch.sourceSystem,
          validationFailures: failures,
        },
        parseProgress: { stage: "done", pct: 100 },
      })
      .where(eq(schema.rentRollBatches.id, batchId));

    revalidateProperty(batch.propertyId);
    return { ok: true };
  } catch (err) {
    await db()
      .update(schema.rentRollBatches)
      .set({
        status: "failed",
        parseProgress: { stage: "error", pct: 100 },
        errorMessage: err instanceof Error ? err.message : "Could not parse the rent roll",
      })
      .where(eq(schema.rentRollBatches.id, batchId));
    revalidateProperty(batch.propertyId);
    return { ok: false, error: err instanceof Error ? err.message : "Could not parse the rent roll" };
  }
}

/**
 * Commit a reviewed rent roll: lock it as the property's newest snapshot and
 * train the mapping memory (format fingerprint + column examples) so the next
 * upload of this format parses deterministically with no AI.
 */
export async function commitRentRoll(batchId: number): Promise<ActionResult> {
  const batch = await db().query.rentRollBatches.findFirst({
    where: eq(schema.rentRollBatches.id, batchId),
  });
  if (!batch) return { ok: false, error: "Rent roll not found" };
  if (batch.status !== "needs_review") {
    return { ok: false, error: "Only a reviewed rent roll can be committed" };
  }

  const meta = (batch.extractedMeta ?? {}) as {
    fingerprint?: string | null;
    headerLabels?: string[];
    mapping?: AiMapping | null;
  };
  if (meta.fingerprint && meta.mapping) {
    try {
      await saveFormatMemory(meta.fingerprint, meta.mapping, batch.sourceSystem, batch.uploadedBy);
      await saveMappingExamples(meta.headerLabels ?? [], meta.mapping, batch.uploadedBy);
    } catch (err) {
      console.error("Failed to train rent-roll mapping memory", err);
      // Non-fatal — committing the snapshot is what matters.
    }
  }

  await db()
    .update(schema.rentRollBatches)
    .set({ status: "committed", committedAt: new Date() })
    .where(eq(schema.rentRollBatches.id, batchId));

  revalidateProperty(batch.propertyId);
  return { ok: true };
}

const updateUnitSchema = z.object({
  unitId: z.coerce.number().int().positive(),
  unitNumber: z.string().trim().min(1).optional(),
  floorPlanCode: z.string().trim().nullable().optional(),
  beds: z.coerce.number().int().nullable().optional(),
  squareFeet: z.coerce.number().int().nullable().optional(),
  marketRent: z.coerce.number().nullable().optional(),
  inPlaceRent: z.coerce.number().nullable().optional(),
  status: z.enum(["occupied", "notice", "vacant", "future"]).optional(),
  residentName: z.string().trim().nullable().optional(),
});

/** Manually correct a parsed unit row; clears its needs-review flag. */
export async function updateUnit(input: z.input<typeof updateUnitSchema>): Promise<ActionResult> {
  const parsed = updateUnitSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const p = parsed.data;
  const unit = await db().query.rentRollUnits.findFirst({
    where: eq(schema.rentRollUnits.id, p.unitId),
  });
  if (!unit) return { ok: false, error: "Unit not found" };

  await db()
    .update(schema.rentRollUnits)
    .set({
      ...(p.unitNumber !== undefined ? { unitNumber: p.unitNumber } : {}),
      ...(p.floorPlanCode !== undefined ? { floorPlanCode: p.floorPlanCode } : {}),
      ...(p.beds !== undefined ? { beds: p.beds } : {}),
      ...(p.squareFeet !== undefined ? { squareFeet: p.squareFeet } : {}),
      ...(p.marketRent !== undefined ? { marketRent: p.marketRent == null ? null : String(p.marketRent) } : {}),
      ...(p.inPlaceRent !== undefined ? { inPlaceRent: p.inPlaceRent == null ? null : String(p.inPlaceRent) } : {}),
      ...(p.status !== undefined ? { status: p.status } : {}),
      ...(p.residentName !== undefined ? { residentName: p.residentName } : {}),
      needsReview: false,
      reviewNote: null,
    })
    .where(eq(schema.rentRollUnits.id, p.unitId));

  revalidateProperty(unit.propertyId);
  return { ok: true };
}

/** Soft-delete a rent-roll snapshot (kept, restorable). */
export async function deleteBatch(batchId: number): Promise<ActionResult> {
  const batch = await db().query.rentRollBatches.findFirst({
    where: eq(schema.rentRollBatches.id, batchId),
  });
  if (!batch) return { ok: false, error: "Rent roll not found" };
  await db()
    .update(schema.rentRollBatches)
    .set({ archivedAt: new Date() })
    .where(eq(schema.rentRollBatches.id, batchId));
  revalidateProperty(batch.propertyId);
  return { ok: true };
}

export async function restoreBatch(batchId: number): Promise<ActionResult> {
  const batch = await db().query.rentRollBatches.findFirst({
    where: eq(schema.rentRollBatches.id, batchId),
  });
  if (!batch) return { ok: false, error: "Rent roll not found" };
  await db()
    .update(schema.rentRollBatches)
    .set({ archivedAt: null })
    .where(eq(schema.rentRollBatches.id, batchId));
  revalidateProperty(batch.propertyId);
  return { ok: true };
}

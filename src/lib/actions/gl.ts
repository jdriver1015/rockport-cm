"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import type { ActionResult } from "@/lib/action-result";

async function revalidateProperty(propertyId: number) {
  revalidatePath(`/properties/${propertyId}/gl`);
  revalidatePath(`/properties/${propertyId}`);
  revalidatePath(`/properties/${propertyId}/projects`);
  revalidatePath(`/properties/${propertyId}/budget`);
  revalidatePath("/");
}

/**
 * Learn a vendor rule from a manual correction so the queue shrinks over time.
 * Only adds one when the vendor isn't already mapped, to avoid noise.
 */
async function learnVendorRule(vendorRaw: string | null, costCodeId: number) {
  if (!vendorRaw) return;
  const pattern = vendorRaw.toLowerCase().trim();
  if (!pattern) return;
  const existing = await db()
    .select({ id: schema.mappingRules.id })
    .from(schema.mappingRules)
    .where(
      and(
        eq(schema.mappingRules.matchType, "vendor"),
        eq(schema.mappingRules.pattern, pattern),
      ),
    )
    .limit(1);
  if (existing.length > 0) return;
  await db()
    .insert(schema.mappingRules)
    .values({ matchType: "vendor", pattern, costCodeId, priority: 90 });
}

const updateSchema = z.object({
  transactionId: z.coerce.number().int().positive(),
  costCodeId: z.coerce.number().int().positive().nullable().optional(),
  projectId: z.coerce.number().int().positive().nullable().optional(),
});

export async function updateTransaction(input: {
  transactionId: number;
  costCodeId?: number | null;
  projectId?: number | null;
}): Promise<ActionResult> {
  const parsed = updateSchema.parse(input);
  const txn = await db().query.glTransactions.findFirst({
    where: eq(schema.glTransactions.id, parsed.transactionId),
  });
  if (!txn) return { ok: false, error: "Transaction not found" };

  const nextCostCode = parsed.costCodeId ?? null;

  await db()
    .update(schema.glTransactions)
    .set({
      costCodeId: nextCostCode,
      projectId: parsed.projectId ?? null,
      // A mapped, non-excluded row becomes ready to post
      status:
        txn.status === "excluded"
          ? "excluded"
          : nextCostCode !== null
            ? "staged"
            : "needs_review",
    })
    .where(eq(schema.glTransactions.id, parsed.transactionId));

  if (nextCostCode !== null && txn.costCodeId !== nextCostCode) {
    await learnVendorRule(txn.vendorRaw, nextCostCode);
  }

  await revalidateProperty(txn.propertyId);
  return { ok: true };
}

export async function excludeTransaction(transactionId: number, reason?: string): Promise<ActionResult> {
  const txn = await db().query.glTransactions.findFirst({
    where: eq(schema.glTransactions.id, transactionId),
  });
  if (!txn) return { ok: false, error: "Transaction not found" };
  await db()
    .update(schema.glTransactions)
    .set({ status: "excluded", excludeReason: reason ?? "Excluded by reviewer", postedAt: null })
    .where(eq(schema.glTransactions.id, transactionId));
  await revalidateProperty(txn.propertyId);
  return { ok: true };
}

/** Move an excluded row back into the review queue */
export async function restoreTransaction(transactionId: number): Promise<ActionResult> {
  const txn = await db().query.glTransactions.findFirst({
    where: eq(schema.glTransactions.id, transactionId),
  });
  if (!txn) return { ok: false, error: "Transaction not found" };
  await db()
    .update(schema.glTransactions)
    .set({
      status: txn.costCodeId !== null ? "staged" : "needs_review",
      excludeReason: null,
    })
    .where(eq(schema.glTransactions.id, transactionId));
  await revalidateProperty(txn.propertyId);
  return { ok: true };
}

/**
 * Recompute the property's "GL updated thru" from its posted rows. Runs after
 * posting AND un-posting, so the date walks backward when the latest posted
 * transaction is pulled back (or to null when nothing remains posted).
 */
async function recomputeGlThru(propertyId: number) {
  const [row] = await db()
    .select({ maxDate: sql<string | null>`max(${schema.glTransactions.txnDate})` })
    .from(schema.glTransactions)
    .where(
      and(
        eq(schema.glTransactions.propertyId, propertyId),
        eq(schema.glTransactions.status, "posted"),
      ),
    );
  await db()
    .update(schema.properties)
    .set({ glUpdatedThru: row?.maxDate ?? null })
    .where(eq(schema.properties.id, propertyId));
}

export async function postTransaction(transactionId: number): Promise<ActionResult> {
  const txn = await db().query.glTransactions.findFirst({
    where: eq(schema.glTransactions.id, transactionId),
  });
  if (!txn) return { ok: false, error: "Transaction not found" };
  if (txn.costCodeId === null) return { ok: false, error: "Assign a cost code before posting" };
  await db()
    .update(schema.glTransactions)
    .set({ status: "posted", postedAt: new Date() })
    .where(eq(schema.glTransactions.id, transactionId));
  await recomputeGlThru(txn.propertyId);
  await revalidateProperty(txn.propertyId);
  return { ok: true };
}

/**
 * Un-post a posted transaction: move it back into the review queue (keeping its
 * cost code and project so re-posting is one click) and recompute the property's
 * GL-updated-thru so JTD reverts everywhere. Reopens its batch if it was closed.
 */
export async function unpostTransaction(transactionId: number): Promise<ActionResult> {
  const txn = await db().query.glTransactions.findFirst({
    where: eq(schema.glTransactions.id, transactionId),
  });
  if (!txn) return { ok: false, error: "Transaction not found" };
  if (txn.status !== "posted") return { ok: true };

  await db()
    .update(schema.glTransactions)
    .set({
      status: txn.costCodeId !== null ? "staged" : "needs_review",
      postedAt: null,
    })
    .where(eq(schema.glTransactions.id, transactionId));

  if (txn.batchId !== null) {
    await db()
      .update(schema.importBatches)
      .set({ status: "in_review" })
      .where(
        and(
          eq(schema.importBatches.id, txn.batchId),
          eq(schema.importBatches.status, "posted"),
        ),
      );
  }

  await recomputeGlThru(txn.propertyId);
  await revalidateProperty(txn.propertyId);
  return { ok: true };
}

/** Post every ready (staged, cost-coded) row across a property */
export async function postAllReady(propertyId: number): Promise<ActionResult<{ count: number }>> {
  const result = await db()
    .update(schema.glTransactions)
    .set({ status: "posted", postedAt: new Date() })
    .where(
      and(
        eq(schema.glTransactions.propertyId, propertyId),
        eq(schema.glTransactions.status, "staged"),
        sql`${schema.glTransactions.costCodeId} is not null`,
      ),
    )
    .returning({ id: schema.glTransactions.id });
  await recomputeGlThru(propertyId);
  await revalidateProperty(propertyId);
  return { ok: true, count: result.length };
}

/**
 * Soft-delete an import batch. Refuses if any row has posted — those are
 * actuals already reflected in JTD/budget figures, so un-post them first
 * rather than archiving under them. The batch and its staged/needs-review/
 * excluded rows are kept and restorable via restoreBatch.
 */
export async function deleteBatch(batchId: number): Promise<ActionResult> {
  const batch = await db().query.importBatches.findFirst({
    where: eq(schema.importBatches.id, batchId),
  });
  if (!batch) return { ok: false, error: "Import not found" };

  const [{ postedCount }] = await db()
    .select({ postedCount: sql<number>`count(*)::int` })
    .from(schema.glTransactions)
    .where(
      and(eq(schema.glTransactions.batchId, batchId), eq(schema.glTransactions.status, "posted")),
    );
  if (postedCount > 0) {
    return {
      ok: false,
      error: "This import has posted transactions — un-post them before deleting",
    };
  }

  await db()
    .update(schema.importBatches)
    .set({ archivedAt: new Date() })
    .where(eq(schema.importBatches.id, batchId));

  await revalidateProperty(batch.propertyId);
  return { ok: true };
}

export async function restoreBatch(batchId: number): Promise<ActionResult> {
  const batch = await db().query.importBatches.findFirst({
    where: eq(schema.importBatches.id, batchId),
  });
  if (!batch) return { ok: false, error: "Import not found" };

  await db()
    .update(schema.importBatches)
    .set({ archivedAt: null })
    .where(eq(schema.importBatches.id, batchId));

  await revalidateProperty(batch.propertyId);
  return { ok: true };
}

/** Post every ready (staged, cost-coded) row in a batch */
export async function postBatch(batchId: number): Promise<ActionResult<{ count: number }>> {
  const batch = await db().query.importBatches.findFirst({
    where: eq(schema.importBatches.id, batchId),
  });
  if (!batch) return { ok: false, error: "Batch not found" };

  const result = await db()
    .update(schema.glTransactions)
    .set({ status: "posted", postedAt: new Date() })
    .where(
      and(
        eq(schema.glTransactions.batchId, batchId),
        eq(schema.glTransactions.status, "staged"),
        sql`${schema.glTransactions.costCodeId} is not null`,
      ),
    )
    .returning({ id: schema.glTransactions.id });

  // Close the batch if nothing remains to review
  const [{ remaining }] = await db()
    .select({ remaining: sql<number>`count(*)::int` })
    .from(schema.glTransactions)
    .where(
      and(
        eq(schema.glTransactions.batchId, batchId),
        sql`${schema.glTransactions.status} in ('staged','needs_review')`,
      ),
    );
  if (remaining === 0) {
    await db()
      .update(schema.importBatches)
      .set({ status: "posted" })
      .where(eq(schema.importBatches.id, batchId));
  }

  await recomputeGlThru(batch.propertyId);
  await revalidateProperty(batch.propertyId);
  return { ok: true, count: result.length };
}

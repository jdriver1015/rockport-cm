"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import type { ActionResult } from "@/lib/action-result";
import { suggestConstructionAccount, type ColumnOverride } from "@/lib/gl-import";
import type { AccountSummary } from "@/lib/gl-import-pipeline";
import { computeNextEditStatus, originalCostCodeAfterEdit } from "@/lib/gl-edit-rules";
import { requireUser, type LoadedProfile } from "@/lib/auth";
import { canWriteProperty } from "@/lib/auth-rules";
import { normalizeVendorPattern, shouldLearnVendorRule } from "@/lib/vendor-rule-rules";
import { propertyPath } from "@/lib/property-path";
import {
  insertMappedTransactions,
  reparseStoredBatch,
  saveFormatMemory,
} from "@/lib/gl-import-pipeline";

async function revalidateProperty(propertyId: number) {
  const path = await propertyPath(propertyId);
  if (!path) return;
  revalidatePath(`${path}/gl`);
  revalidatePath(path);
  revalidatePath(`${path}/projects`);
  revalidatePath(`${path}/budget`);
  revalidatePath("/");
}

/**
 * Learn a vendor rule from a manual correction.
 *
 * Guards:
 *  - The pattern must normalize to a usable string.
 *  - The vendor must have hit at least MIN_VENDOR_HIT_COUNT_FOR_LEARN times in
 *    the current batch hitting the same code, OR `forceLearn` is true (used
 *    by programmatic callers that know what they're doing).
 *  - No conflict with an existing rule for the same chart + pattern.
 *  - The role permitted to write mapping rules is enforced upstream; this
 *    helper trusts its caller. (See requireUser() in the action layer.)
 *
 * Provenance: `profile.id` is recorded as `createdBy` on insert and is
 * sticky — the conflict-path update only writes priority + updatedAt, never
 * overwrites createdBy. See src/lib/db/schema.ts:mappingRules.
 */
async function learnVendorRule(
  vendorRaw: string | null,
  costCodeId: number,
  profile: LoadedProfile,
  hitCount: number,
) {
  // The rule lives in the same chart as the code it maps to.
  const code = await db().query.costCodes.findFirst({
    where: eq(schema.costCodes.id, costCodeId),
    columns: { chartId: true },
  });
  if (!code) return;

  const normalized = normalizeVendorPattern(vendorRaw);
  if (!normalized) return;

  const existing = await db()
    .select({
      id: schema.mappingRules.id,
      costCodeId: schema.mappingRules.costCodeId,
    })
    .from(schema.mappingRules)
    .where(
      and(
        eq(schema.mappingRules.chartId, code.chartId),
        eq(schema.mappingRules.matchType, "vendor"),
        eq(schema.mappingRules.pattern, normalized),
      ),
    )
    .limit(1);

  const existingRuleCostCodeId = existing[0]?.costCodeId ?? null;
  const conflicting =
    existingRuleCostCodeId !== null && existingRuleCostCodeId !== costCodeId;

  if (
    !shouldLearnVendorRule({
      vendorRaw: normalized,
      hitCount,
      existingRuleCostCodeId,
      existingRuleCostCodeIdDifferent: conflicting,
    })
  ) {
    return;
  }

  await db()
    .insert(schema.mappingRules)
    .values({
      chartId: code.chartId,
      matchType: "vendor",
      pattern: normalized,
      costCodeId,
      priority: 90,
      createdBy: profile.id,
    });
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
  // Auth gate: every action that mutates GL data must require a signed-in
  // user with write scope. (See src/lib/auth.ts for the helper and
  // src/lib/auth-rules.ts for the matrix.)
  const auth = await requireUser();
  if (!auth.ok) return auth;
  if (!canWriteProperty(auth.profile.role)) {
    return { ok: false, error: "You don't have permission to edit transactions" };
  }
  const profile = auth.profile;

  const parsed = updateSchema.parse(input);
  const txn = await db().query.glTransactions.findFirst({
    where: eq(schema.glTransactions.id, parsed.transactionId),
  });
  if (!txn) return { ok: false, error: "Transaction not found" };

  const nextCostCode = parsed.costCodeId ?? null;

  // A code assigned here must belong to the property's chart of accounts.
  if (nextCostCode !== null) {
    const [property, code] = await Promise.all([
      db().query.properties.findFirst({
        where: eq(schema.properties.id, txn.propertyId),
        columns: { chartOfAccountsId: true },
      }),
      db().query.costCodes.findFirst({
        where: eq(schema.costCodes.id, nextCostCode),
        columns: { chartId: true },
      }),
    ]);
    if (!code) return { ok: false, error: "Cost code not found" };
    if (!property || code.chartId !== property.chartOfAccountsId) {
      return { ok: false, error: "That cost code isn't in this property's chart of accounts" };
    }
  }

  // Drive the status/postedAt/partition transitions through one testable
  // helper — see src/lib/gl-edit-rules.ts and tests/gl-edit-rules.test.ts.
  // A posted row's edit is treated as a correction that invalidates the
  // posted actuals (regardless of whether the cost code actually changed)
  // and the batch is reopened so re-review is required. Excluded rows are
  // excluded-sticky; re-inclusion must go through restoreTransaction.
  const decision = computeNextEditStatus({
    currentStatus: txn.status,
    willHaveCostCode: nextCostCode !== null,
  });

  // originalCostCodeId is sticky across corrections: once it has a value it
  // stays put until something is posted again, so an un-post can restore it.
  const originalDecision = originalCostCodeAfterEdit({
    currentlyPostedCodeId: txn.status === "posted" ? txn.costCodeId : null,
    newEditCodeId: nextCostCode,
    existingOriginalCodeId: txn.originalCostCodeId ?? null,
  });

  await db()
    .update(schema.glTransactions)
    .set({
      costCodeId: nextCostCode,
      originalCostCodeId: originalDecision.nextOriginal,
      projectId: parsed.projectId ?? null,
      status: decision.status,
      ...(decision.shouldClearPostedAt ? { postedAt: null } : {}),
    })
    .where(eq(schema.glTransactions.id, parsed.transactionId));

  if (decision.shouldReopenBatch && txn.batchId !== null) {
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

  if (nextCostCode !== null && txn.costCodeId !== nextCostCode) {
    // Count how many OTHER rows in this batch's auto-mapped set share the
    // same vendorRaw + same cost code — that's the signal for whether to
    // learn a rule vs leaving the correction as a one-off. Count is bounded
    // by the batch size in practice (rarely more than a few hundred).
    //
    // Skipped when batchId is null (the row isn't part of any batch) — the
    // one-row-from-this-batch signal doesn't exist, so we err on the safe
    // side and don't learn. A future correction against the same code
    // will get another chance.
    if (txn.batchId !== null) {
      const normalized = normalizeVendorPattern(txn.vendorRaw) ?? "";
      const sameCode = await db()
        .select({ id: schema.glTransactions.id })
        .from(schema.glTransactions)
        .where(
          and(
            eq(schema.glTransactions.batchId, txn.batchId),
            eq(schema.glTransactions.costCodeId, nextCostCode),
            sql`lower(coalesce(${schema.glTransactions.vendorRaw}, '')) = ${normalized}`,
          ),
        );
      await learnVendorRule(txn.vendorRaw, nextCostCode, profile, sameCode.length);
    }
  }

  await revalidateProperty(txn.propertyId);
  return { ok: true };
}

export async function excludeTransaction(transactionId: number, reason?: string): Promise<ActionResult> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  if (!canWriteProperty(auth.profile.role)) {
    return { ok: false, error: "You don't have permission to exclude transactions" };
  }

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
  const auth = await requireUser();
  if (!auth.ok) return auth;
  if (!canWriteProperty(auth.profile.role)) {
    return { ok: false, error: "You don't have permission to restore transactions" };
  }

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
  const auth = await requireUser();
  if (!auth.ok) return auth;
  if (!canWriteProperty(auth.profile.role)) {
    return { ok: false, error: "You don't have permission to post transactions" };
  }

  const txn = await db().query.glTransactions.findFirst({
    where: eq(schema.glTransactions.id, transactionId),
  });
  if (!txn) return { ok: false, error: "Transaction not found" };
  if (txn.costCodeId === null) return { ok: false, error: "Assign a cost code before posting" };

  // Stamp the cost code as the "original" so a future un-post + restore can
  // put it back. If originalCostCodeId is already set (re-post of a corrected
  // row), leave it pinned — see gl-edit-rules.ts:originalCostCodeAfterEdit.
  await db()
    .update(schema.glTransactions)
    .set({
      status: "posted",
      postedAt: new Date(),
      originalCostCodeId: txn.originalCostCodeId ?? txn.costCodeId,
    })
    .where(eq(schema.glTransactions.id, transactionId));
  await recomputeGlThru(txn.propertyId);
  await revalidateProperty(txn.propertyId);
  return { ok: true };
}

/**
 * Un-post a posted transaction: move it back into the review queue, restore
 * its cost code to the value it was POSTED AS (captured on originalCostCodeId
 * at post time), and recompute the property's GL-updated-thru so JTD reverts
 * everywhere. Reopens its batch if it was closed.
 */
export async function unpostTransaction(transactionId: number): Promise<ActionResult> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  if (!canWriteProperty(auth.profile.role)) {
    return { ok: false, error: "You don't have permission to unpost transactions" };
  }

  const txn = await db().query.glTransactions.findFirst({
    where: eq(schema.glTransactions.id, transactionId),
  });
  if (!txn) return { ok: false, error: "Transaction not found" };
  if (txn.status !== "posted") return { ok: true };

  // Restore the cost code to the value originally posted. If originalCostCodeId
  // is null (legacy rows from before the column was added), fall back to the
  // current costCodeId so we don't blank the field — preserves accounting
  // while the backfill script catches up.
  const restoredCodeId = txn.originalCostCodeId ?? txn.costCodeId;
  await db()
    .update(schema.glTransactions)
    .set({
      status: restoredCodeId !== null ? "staged" : "needs_review",
      postedAt: null,
      costCodeId: restoredCodeId,
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
  const auth = await requireUser();
  if (!auth.ok) return auth;
  if (!canWriteProperty(auth.profile.role)) {
    return { ok: false, error: "You don't have permission to delete imports" };
  }

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
  const auth = await requireUser();
  if (!auth.ok) return auth;
  if (!canWriteProperty(auth.profile.role)) {
    return { ok: false, error: "You don't have permission to restore imports" };
  }

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

const columnOverrideSchema = z.object({
  sheetName: z.string().optional(),
  headerRow: z.number().int().nonnegative(),
  date: z.number().int().nonnegative().optional(),
  vendor: z.number().int().nonnegative().optional(),
  description: z.number().int().nonnegative().optional(),
  amount: z.number().int().nonnegative().optional(),
  debit: z.number().int().nonnegative().optional(),
  credit: z.number().int().nonnegative().optional(),
  invoice: z.number().int().nonnegative().optional(),
  check: z.number().int().nonnegative().optional(),
  draw: z.number().int().nonnegative().optional(),
  account: z.number().int().nonnegative().optional(),
  unit: z.number().int().nonnegative().optional(),
});

/**
 * Finish a `needs_mapping` batch: apply a manual column mapping, remember it for
 * this format (so future imports auto-recognize it), then re-parse and route the
 * batch onward — to account selection (grouped ledger) or straight into the
 * review queue (flat file).
 */
export async function confirmImportColumns(
  batchId: number,
  mapping: ColumnOverride,
): Promise<ActionResult> {
  const parsedMapping = columnOverrideSchema.safeParse(mapping);
  if (!parsedMapping.success) {
    return { ok: false, error: parsedMapping.error.issues[0]?.message ?? "Invalid mapping" };
  }
  const override = parsedMapping.data;
  if (override.amount === undefined && override.debit === undefined && override.credit === undefined) {
    return { ok: false, error: "Map an Amount column, or Debit and/or Credit columns" };
  }
  if (override.vendor === undefined && override.description === undefined) {
    return { ok: false, error: "Map a Vendor or Description column" };
  }

  const batch = await db().query.importBatches.findFirst({
    where: eq(schema.importBatches.id, batchId),
  });
  if (!batch) return { ok: false, error: "Import not found" };
  if (batch.status !== "needs_mapping") {
    return { ok: false, error: "This import has already been mapped" };
  }
  if (!batch.storagePath) {
    return { ok: false, error: "Original file is missing — re-upload the GL export" };
  }

  try {
    const parsed = await reparseStoredBatch(batch.storagePath, override);
    if (parsed.rows.length === 0) {
      return { ok: false, error: "That mapping produced no transactions — check the columns" };
    }

    const uploader = batch.uploadedBy ?? null;
    await saveFormatMemory(parsed.headerLabels, override, batch.sourceSystem, uploader);

    if (parsed.layout === "grouped") {
      const remembered = new Map(
        (
          await db()
            .select({
              accountCode: schema.glPropertyAccounts.accountCode,
              isConstruction: schema.glPropertyAccounts.isConstruction,
            })
            .from(schema.glPropertyAccounts)
            .where(eq(schema.glPropertyAccounts.propertyId, batch.propertyId))
        ).map((r) => [r.accountCode, r.isConstruction] as const),
      );
      const summary: AccountSummary[] = parsed.sections.map((s) => ({
        code: s.code,
        name: s.name,
        rowCount: s.rows.length,
        total: s.total,
        suggested: remembered.get(s.code) ?? suggestConstructionAccount(s.code, s.name),
        remembered: remembered.has(s.code),
      }));
      await db()
        .update(schema.importBatches)
        .set({
          status: "needs_accounts",
          periodDate: parsed.periodDate,
          accountSummary: summary,
        })
        .where(eq(schema.importBatches.id, batchId));
      await revalidateProperty(batch.propertyId);
      return { ok: true };
    }

    // Flat file: import everything straight to the review queue.
    const counts = await insertMappedTransactions(batch.propertyId, batchId, parsed.rows);
    await db()
      .update(schema.importBatches)
      .set({
        status: "in_review",
        rowCount: counts.rowCount,
        autoMappedCount: counts.autoMappedCount,
        needsReviewCount: counts.needsReviewCount,
        periodDate: parsed.periodDate,
      })
      .where(eq(schema.importBatches.id, batchId));
    await revalidateProperty(batch.propertyId);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not apply the column mapping",
    };
  }
}

/**
 * Finish a `needs_accounts` batch: remember which GL account sections are
 * construction for this property, then materialize only the selected accounts'
 * rows as staged transactions. Re-parses the archived file so no giant staging
 * blob is kept in the DB.
 */
export async function confirmImportAccounts(
  batchId: number,
  includedCodes: string[],
): Promise<ActionResult<{ count: number }>> {
  const batch = await db().query.importBatches.findFirst({
    where: eq(schema.importBatches.id, batchId),
  });
  if (!batch) return { ok: false, error: "Import not found" };
  if (batch.status !== "needs_accounts") {
    return { ok: false, error: "This import has already been processed" };
  }
  if (!batch.storagePath) {
    return { ok: false, error: "Original file is missing — re-upload the GL export" };
  }

  const summary = (batch.accountSummary ?? []) as AccountSummary[];
  const included = new Set(includedCodes);

  try {
    // Remember every account's decision for this property in ONE upsert (a full
    // GL can have hundreds of sections — a per-row loop is hundreds of round
    // trips and will time out on a serverless function).
    if (summary.length > 0) {
      const now = new Date();
      await db()
        .insert(schema.glPropertyAccounts)
        .values(
          summary.map((s) => ({
            propertyId: batch.propertyId,
            accountCode: s.code,
            accountName: s.name,
            isConstruction: included.has(s.code),
            updatedAt: now,
          })),
        )
        .onConflictDoUpdate({
          target: [schema.glPropertyAccounts.propertyId, schema.glPropertyAccounts.accountCode],
          set: {
            isConstruction: sql`excluded.is_construction`,
            accountName: sql`excluded.account_name`,
            updatedAt: now,
          },
        });
    }

    const parsed = await reparseStoredBatch(batch.storagePath);
    const rows = parsed.rows.filter((r) => r.glAccountRaw != null && included.has(r.glAccountRaw));

    const counts = await insertMappedTransactions(batch.propertyId, batchId, rows);
    await db()
      .update(schema.importBatches)
      .set({
        status: "in_review",
        rowCount: counts.rowCount,
        autoMappedCount: counts.autoMappedCount,
        needsReviewCount: counts.needsReviewCount,
        accountSummary: null,
      })
      .where(eq(schema.importBatches.id, batchId));

    await revalidateProperty(batch.propertyId);
    return { ok: true, count: counts.rowCount };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not import the selected accounts",
    };
  }
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

  // Close the batch when NO non-posted rows remain. Excluded rows count as
  // "still open" — a batch full of exclusions was processed but not closed,
  // and the user can restore rows from it. Counting only staged/needs_review
  // would auto-mark a batch of all-exclusions "posted", silently swallowing
  // the rejections.
  const [{ remaining }] = await db()
    .select({ remaining: sql<number>`count(*)::int` })
    .from(schema.glTransactions)
    .where(
      and(
        eq(schema.glTransactions.batchId, batchId),
        sql`${schema.glTransactions.status} <> 'posted'`,
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

/**
 * Pure decision rules for editing a GL transaction.
 *
 * Extracted from src/lib/actions/gl.ts so the state machine is testable without
 * a database — server actions wrap these to drive the actual updates.
 *
 * INVARIANTS
 * ----------
 *  1. An `excluded` row stays `excluded` regardless of the new cost code —
 *     re-inclusion must go through `restoreTransaction`, never an edit.
 *  2. Editing a `posted` row is a correction that invalidates the posted
 *     actuals, regardless of whether the cost code actually changed. The
 *     caller must: clear `postedAt`, drop status to `staged` (if a code is
 *     supplied) or `needs_review` (if not), and reopen its batch so the next
 *     "Post all ready" can carry it again. Re-review is required.
 *  3. A `needs_review` row that gets a code resolves to `staged`. Dropping
 *     the code keeps it at `needs_review`.
 *  4. A `staged` row keeps `staged` if a code is supplied, drops to
 *     `needs_review` if not.
 *  5. `originalCostCodeId` is a sticky history field. See `originalCostCodeAfterEdit`
 *     for the rules — the first time a row is posted, that code is recorded;
 *     subsequent edits do not blank or overwrite it.
 */

export type TxnStatus = "staged" | "needs_review" | "posted" | "excluded";

export type NextEditDecision = {
  /** The status the row should have after the edit. */
  status: TxnStatus;
  /** True when the caller should set postedAt = null (correction detected). */
  shouldClearPostedAt: boolean;
  /** True when the caller should reopen the batch from "posted" to "in_review". */
  shouldReopenBatch: boolean;
};

export type NextEditInput = {
  currentStatus: TxnStatus;
  /** Whether the row will end up with a non-null cost code after the edit. */
  willHaveCostCode: boolean;
};

export function computeNextEditStatus(input: NextEditInput): NextEditDecision {
  // Rule 1: excluded is sticky. The user's intent with an edit is ALWAYS to
  // re-include via restoreTransaction — a silent un-exclude would erase the
  // reason why the row was excluded without anyone noticing.
  if (input.currentStatus === "excluded") {
    return { status: "excluded", shouldClearPostedAt: false, shouldReopenBatch: false };
  }

  // Rule 2: posted is the dangerous one. A correction invalidates the posted
  // actuals whether the cost code actually changed or not — the reviewer
  // could have edited and reverted, and we can't tell the difference, so we
  // treat any edit as a correction. Re-review is required.
  if (input.currentStatus === "posted") {
    return {
      status: input.willHaveCostCode ? "staged" : "needs_review",
      shouldClearPostedAt: true,
      shouldReopenBatch: true,
    };
  }

  // Rules 3 and 4: non-posted rows toggle between staged / needs_review based
  // on whether the edit supplied a cost code. No status-event written here.
  const status: TxnStatus = input.willHaveCostCode ? "staged" : "needs_review";
  return { status, shouldClearPostedAt: false, shouldReopenBatch: false };
}

export type OriginalCostCodeInput = {
  /** The row's CURRENT costCodeId if the row is currently in "posted" status, else null. */
  currentlyPostedCodeId: number | null;
  /** The code the reviewer is assigning in this edit (may equal existing or differ). */
  newEditCodeId: number | null;
  /** The row's existing originalCostCodeId, if any. */
  existingOriginalCodeId: number | null;
};

export type OriginalCostCodeDecision = {
  /** The value originalCostCodeId should hold after the edit. */
  nextOriginal: number | null;
};

/**
 * Decide what originalCostCodeId should be after an edit.
 *
 * The column records the cost code the row was LAST POSTED AS, so an
 * un-post / restore can put it back. Once written, it does not move:
 * a later correction to a different code while the row is staged or
 * needs_review just leaves originalCostCodeId pinned to the code that
 * was originally posted.
 *
 * Edge cases:
 *  - editing a posted row captures the currently-posted code (which is
 *    what was actually in the GL), not the new edit code.
 *  - if the row has never been posted, the column stays null.
 */
export function originalCostCodeAfterEdit(input: OriginalCostCodeInput): OriginalCostCodeDecision {
  // The only moment a non-null originalCodeId is written is when the row is
  // currently posted (the edit forces it back to staged, but at the moment
  // of the edit the code that was just posted is what we want to remember).
  if (input.currentlyPostedCodeId !== null) {
    return { nextOriginal: input.currentlyPostedCodeId };
  }
  // Otherwise: sticky. A later edit on a corrected row must not blank the
  // history.
  return { nextOriginal: input.existingOriginalCodeId };
}

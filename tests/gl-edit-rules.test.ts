/**
 * Pure-function tests for the GL transaction edit decision.
 *
 * The functions under test encapsulate the rule "what status should this row
 * be in after a reviewer edits it, and which side-effects does the action need
 * to drive?" — see `computeNextEditStatus` and `originalCostCodeAfterEdit` in
 * src/lib/gl-edit-rules.ts.
 *
 * Branches covered:
 *  - excluded transactions stay excluded regardless of the new code
 *  - posted transactions force-unpost on any edit, even no-op same code
 *  - staged rows keep their status if they still have a code, else fall to
 *    needs_review
 *  - needs_review rows promote to staged once a code is assigned
 *  - originalCostCodeId is preserved across the chain (set once at post time,
 *    never silently cleared by a later correction)
 */
import { describe, expect, test } from "vitest";
import {
  computeNextEditStatus,
  originalCostCodeAfterEdit,
} from "@/lib/gl-edit-rules";

describe("computeNextEditStatus", () => {
  test("excluded rows stay excluded even when a cost code is assigned", () => {
    const result = computeNextEditStatus({
      currentStatus: "excluded",
      willHaveCostCode: true,
    });
    expect(result.status).toBe("excluded");
    expect(result.shouldClearPostedAt).toBe(false);
    expect(result.shouldReopenBatch).toBe(false);
  });

  test("excluded rows stay excluded when no cost code is assigned", () => {
    const result = computeNextEditStatus({
      currentStatus: "excluded",
      willHaveCostCode: false,
    });
    expect(result.status).toBe("excluded");
    expect(result.shouldClearPostedAt).toBe(false);
  });

  test("posted rows force-unpost when a cost code changes (or stays the same)", () => {
    const result = computeNextEditStatus({
      currentStatus: "posted",
      willHaveCostCode: true,
    });
    expect(result.status).toBe("staged");
    expect(result.shouldClearPostedAt).toBe(true);
    expect(result.shouldReopenBatch).toBe(true);
  });

  test("needs_review rows promote to staged when given a cost code", () => {
    const result = computeNextEditStatus({
      currentStatus: "needs_review",
      willHaveCostCode: true,
    });
    expect(result.status).toBe("staged");
    expect(result.shouldClearPostedAt).toBe(false);
    expect(result.shouldReopenBatch).toBe(false);
  });

  test("needs_review rows stay in needs_review when no cost code is assigned", () => {
    const result = computeNextEditStatus({
      currentStatus: "needs_review",
      willHaveCostCode: false,
    });
    expect(result.status).toBe("needs_review");
    expect(result.shouldClearPostedAt).toBe(false);
  });

  test("staged rows keep their status when they still have a cost code", () => {
    const result = computeNextEditStatus({
      currentStatus: "staged",
      willHaveCostCode: true,
    });
    expect(result.status).toBe("staged");
    expect(result.shouldClearPostedAt).toBe(false);
  });

  test("staged rows drop to needs_review when the code is cleared", () => {
    const result = computeNextEditStatus({
      currentStatus: "staged",
      willHaveCostCode: false,
    });
    expect(result.status).toBe("needs_review");
    expect(result.shouldClearPostedAt).toBe(false);
  });
});

describe("originalCostCodeAfterEdit", () => {
  test("it captures the previously-posted code if the row is currently posted", () => {
    // After a posted-row correction, originalCostCodeId must remember what was
    // posted so un-post / restore can put it back. The "currently-posted" code
    // is the source of truth, not the new edit.
    expect(
      originalCostCodeAfterEdit({
        currentlyPostedCodeId: 42,
        newEditCodeId: 99,
        existingOriginalCodeId: 42,
      }).nextOriginal,
    ).toBe(42);
  });

  test("it preserves the existing pinned value when the row is NOT posted", () => {
    // A previously-corrected row's originalCostCodeId is sticky. Re-editing it
    // while it's in `staged` must not blank the prior correction history.
    expect(
      originalCostCodeAfterEdit({
        currentlyPostedCodeId: null,
        newEditCodeId: 99,
        existingOriginalCodeId: 42,
      }).nextOriginal,
    ).toBe(42);
  });

  test("it stays null when nothing has ever been posted", () => {
    expect(
      originalCostCodeAfterEdit({
        currentlyPostedCodeId: null,
        newEditCodeId: 99,
        existingOriginalCodeId: null,
      }).nextOriginal,
    ).toBeNull();
  });
});

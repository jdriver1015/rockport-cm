/**
 * Pure rules for the "learn a vendor mapping rule from a reviewer correction"
 * decision.
 *
 * The bug these rules fix: every reviewer's one-off correction used to insert
 * a fresh vendor-rule row, so a single typo fix would silently teach the
 * entire portfolio to map that vendor to a specific cost code forever. These
 * rules separate "noisy single correction" from "actually-confirmed mapping"
 * using only data already in hand — the count of matching auto-mapped rows
 * in the current batch.
 *
 * Source for the batch rows: src/lib/gl-import-pipeline.ts returns the
 * auto-mapped rows for each batch in one query (counts of autoMap). We pass
 * the relevant slices in via the inputs.
 */
import { describe, expect, test } from "vitest";
import { shouldLearnVendorRule, normalizeVendorPattern } from "@/lib/vendor-rule-rules";

describe("shouldLearnVendorRule", () => {
  test("denies when the vendor string is missing", () => {
    expect(shouldLearnVendorRule({ vendorRaw: null, hitCount: 5 })).toBe(false);
    expect(shouldLearnVendorRule({ vendorRaw: "   ", hitCount: 5 })).toBe(false);
  });

  test("denies when only one row hit in the batch", () => {
    // One correction is almost always a typo fix or a one-off code edit. Don't
    // freeze it as a portfolio-wide rule.
    expect(shouldLearnVendorRule({ vendorRaw: "ACME Plumbing", hitCount: 1 })).toBe(false);
  });

  test("approves when at least two rows hit", () => {
    expect(shouldLearnVendorRule({ vendorRaw: "ACME Plumbing", hitCount: 2 })).toBe(true);
    expect(shouldLearnVendorRule({ vendorRaw: "ACME Plumbing", hitCount: 7 })).toBe(true);
  });

  test("denies when the existing rule already overrides the new code", () => {
    // An existing rule (same chart + pattern) that maps to a different code
    // means a priority conflict: learning would create two rules for the
    // same pattern. Skip — the reviewer can edit the existing rule by hand.
    expect(
      shouldLearnVendorRule({
        vendorRaw: "ACME Plumbing",
        hitCount: 5,
        existingRuleCostCodeId: 99,
        existingRuleCostCodeIdDifferent: true,
      }),
    ).toBe(false);
  });
});

describe("normalizeVendorPattern", () => {
  test("lowercases and trims", () => {
    expect(normalizeVendorPattern("  ACME Plumbing  ")).toBe("acme plumbing");
  });

  test("collapses internal whitespace", () => {
    // A PM export might have "ACME   Plumbing". Two patterns would never
    // both be remembered as the same rule — collapse so the dedup works.
    expect(normalizeVendorPattern("ACME    Plumbing")).toBe("acme plumbing");
  });

  test("returns null for non-strings (defensive)", () => {
    // Caller sometimes passes null/undefined; never persist the literal "null".
    expect(normalizeVendorPattern(null)).toBeNull();
    expect(normalizeVendorPattern(undefined)).toBeNull();
  });
});

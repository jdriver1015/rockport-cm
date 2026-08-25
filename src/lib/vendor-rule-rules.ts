/**
 * Pure rules for "should this vendor correction become a learned rule?".
 *
 * Extracted from src/lib/actions/gl.ts so the threshold logic is testable
 * without a database. The actual DB write happens in `learnVendorRule`,
 * which calls into here for the go/no-go decision.
 *
 * INVARIANTS
 * ----------
 *  1. A single correction is NEVER enough to learn a rule. One reviewer fix
 *     is almost always a typo, a one-off re-code, or a temporary accounting
 *     change that should NOT become portfolio-wide default behavior.
 *  2. Two or more rows in the same batch pointing the same vendor at the
 *     same cost code is strong enough signal to commit.
 *  3. The pattern that goes into the rule is a normalized form (lowercased,
 *     trimmed, internal whitespace collapsed) so that "ACME  Plumbing",
 *     "ACME Plumbing", and "acme plumbing" all match the same dedup key.
 *  4. If a rule already exists for the same chart + pattern, learning is
 *     skipped — the existing rule wins. The reviewer can edit priority by
 *     hand if they want the new code to shadow.
 *
 * The threshold (currently 2) is intentionally a constant exported from
 * this file so the value is visible in one place and tweakable per
 * portfolio context if the volume warrants it.
 */

export const MIN_VENDOR_HIT_COUNT_FOR_LEARN = 2;

export type ShouldLearnInput = {
  /** Raw vendor string from the GL export. */
  vendorRaw: string | null | undefined;
  /** Number of auto-mapped rows in the current batch that hit vendorRaw
   *  AND resolve to the same cost code being learned. */
  hitCount: number;
  /** Cost-code id of an existing rule for (chart, pattern). Pass null
   *  if no rule exists yet. */
  existingRuleCostCodeId?: number | null;
  /** True when the existing rule's cost code differs from the new one. */
  existingRuleCostCodeIdDifferent?: boolean;
};

/**
 * Should the action insert a `mapping_rules` row for this correction?
 *
 * Returns true only when:
 *   - vendorRaw has a usable normalized value, AND
 *   - hitCount >= MIN_VENDOR_HIT_COUNT_FOR_LEARN, AND
 *   - no conflicting existing rule.
 */
export function shouldLearnVendorRule(input: ShouldLearnInput): boolean {
  const normalized = normalizeVendorPattern(input.vendorRaw);
  if (!normalized) return false;
  if (input.hitCount < MIN_VENDOR_HIT_COUNT_FOR_LEARN) return false;
  if (
    input.existingRuleCostCodeId != null &&
    input.existingRuleCostCodeIdDifferent === true
  ) {
    return false;
  }
  return true;
}

/**
 * Normalize a vendor string to the form used as the mapping_rules.pattern
 * value. Returns null for inputs that can't be normalized (always-empty,
 * non-strings).
 */
export function normalizeVendorPattern(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  if (typeof raw !== "string") return null;
  const collapsed = raw.trim().replace(/\s+/g, " ").toLowerCase();
  return collapsed === "" ? null : collapsed;
}

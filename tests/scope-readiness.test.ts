/**
 * Pure tests for the one "is this scope ready to go out" rule.
 *
 * The server's confirm (scopeConfirmBlocker) and the Scope & Bids dialog both
 * read it, so these pin the order and wording the person sees either way.
 */
import { describe, expect, test } from "vitest";
import { scopeReadiness, type ReadinessLine } from "@/lib/scope-readiness";

const line = (over: Partial<ReadinessLine> = {}): ReadinessLine => ({
  item: "Paint",
  description: "Two coats",
  quantity: "1",
  unitPrice: "100",
  ...over,
});

describe("scopeReadiness", () => {
  test("a priced, named, described scope is ready", () => {
    expect(scopeReadiness([line()], true).blocker).toBeNull();
  });

  test("no lines is not a scope", () => {
    expect(scopeReadiness([], true).blocker).toBe("There is no scope to confirm");
  });

  test("an unpriced line is named, and price comes before anything else", () => {
    const r = scopeReadiness([line({ item: "Roof", unitPrice: null, description: null })], true);
    expect(r.blocker).toBe("1 scope line still needs a price: Roof");
    expect(r.unpricedCount).toBe(1);
  });

  test("a zero price is a price, not a gap", () => {
    expect(scopeReadiness([line({ unitPrice: "0" })], true).blocker).toBeNull();
  });

  test("a blank name is refused — the rule the dialog's old copy missed", () => {
    expect(scopeReadiness([line({ item: "  " })], true).blocker).toBe("1 scope line still needs a name");
  });

  test("descriptions are required only when asked for", () => {
    const undescribed = [line({ item: "Siding", description: "" })];
    expect(scopeReadiness(undescribed, true).blocker).toBe(
      "1 scope line still needs a description: Siding",
    );
    expect(scopeReadiness(undescribed, false).blocker).toBeNull();
  });

  test("more than three lines are summarised, and plurals agree", () => {
    const lines = ["A", "B", "C", "D", "E"].map((item) => line({ item, quantity: null }));
    expect(scopeReadiness(lines, false).blocker).toBe(
      "5 scope lines still need a price: A, B, C and 2 more",
    );
  });
});

/**
 * Pure-function tests for the pre-con bid and contract gates.
 *
 * Both used to answer a yes/no question — "is any bid approved", "is a contract
 * signed" — which a project letting its scope to several vendors cannot answer.
 * They read coverage and counts now: the bid gate is met when every scope line
 * has somebody on it, the contract gate when no award is still waiting on a
 * signature. See `bidCheck` and `contractCheck` in src/lib/phase-gates.ts.
 *
 * Branches covered:
 *  - nothing awarded, with requests still out
 *  - a PARTIAL award, which used to satisfy the bid gate and no longer does
 *  - full coverage by one vendor, by several, and by direct award
 *  - a split job with an award not yet papered
 *  - every contract generated but not all executed
 *  - everything executed, single and split
 *  - an empty scope, which cannot be fully awarded
 */
import { describe, expect, test } from "vitest";
import { evaluateGates } from "@/lib/phase-gates";

/** A project mid-precon: walked, scoped, budgeted, RFP out. Nothing awarded. */
const base = {
  preWalkDate: "2026-08-01",
  preWalkAuditStatus: "complete" as const,
  scopeLineCount: 5,
  scopeConfirmedAt: new Date("2026-08-02"),
  approvedBudget: 60000,
  bidsSent: 2,
  oldestSentDays: 3,
  directAward: false,
  contractOutDays: null,
  contractStatus: null,
  hasApprovedBid: false,
  awardCount: 0,
  scopeLinesAwarded: 0,
  contractsLive: 0,
  contractsExecuted: 0,
  contractSignedAt: null,
  bidsOutstanding: 2,
  scopeNotStartedCount: 0,
  scopeCompleteCount: 0,
  scopeTotalCount: 5,
  hasActualStart: false,
  openFindingCount: 0,
  openFindingAuditId: null,
  postedGlTotal: 0,
};

/** One gate check out of the precon → in_process set. */
function check(over: Partial<typeof base>, key: "bid" | "contract") {
  const result = evaluateGates("precon", "in_process", { ...base, ...over });
  return result.checks.find((c) => c.key === key)!;
}

/** Everything let to one vendor. */
const fullyAwarded = { awardCount: 1, hasApprovedBid: true, scopeLinesAwarded: 5 };
/** Everything let, split between two. */
const splitAwarded = { awardCount: 2, hasApprovedBid: true, scopeLinesAwarded: 5 };

describe("bidCheck", () => {
  test("stays open while requests are out and nothing is awarded", () => {
    const c = check({}, "bid");
    expect(c.met).toBe(false);
    expect(c.detail).toBe("2 out for bid");
  });

  test("a partial award does not meet the gate", () => {
    const c = check({ awardCount: 1, hasApprovedBid: true, scopeLinesAwarded: 3 }, "bid");
    expect(c.met).toBe(false);
    expect(c.label).toBe("Award the Rest");
    expect(c.detail).toBe("3 of 5 lines awarded");
  });

  test("full coverage by one vendor meets it", () => {
    const c = check(fullyAwarded, "bid");
    expect(c.met).toBe(true);
    expect(c.detail).toBe("Awarded");
  });

  test("full coverage split across two vendors meets it and says so", () => {
    const c = check(splitAwarded, "bid");
    expect(c.met).toBe(true);
    expect(c.detail).toBe("2 vendors awarded");
  });

  test("a direct award covering everything still reads as assigned directly", () => {
    const c = check({ ...fullyAwarded, directAward: true }, "bid");
    expect(c.met).toBe(true);
    expect(c.detail).toBe("Assigned directly");
  });

  test("an empty scope cannot be fully awarded", () => {
    expect(check({ scopeLineCount: 0, scopeLinesAwarded: 0 }, "bid").met).toBe(false);
  });
});

describe("contractCheck", () => {
  test("names the award that has no contract yet", () => {
    const c = check({ ...splitAwarded, contractsLive: 1, contractsExecuted: 1 }, "contract");
    expect(c.met).toBe(false);
    expect(c.detail).toBe("1 of 2 contracts generated");
  });

  test("reports execution progress once every contract exists", () => {
    const c = check(
      {
        ...splitAwarded,
        contractsLive: 2,
        contractsExecuted: 1,
        contractStatus: "out_for_signature",
        contractOutDays: 4,
      },
      "contract",
    );
    expect(c.met).toBe(false);
    expect(c.detail).toBe("1 of 2 executed");
    expect(c.waitingDays).toBe(4);
  });

  test("is met when every award is executed, and shows the count", () => {
    const c = check(
      { ...splitAwarded, contractsLive: 2, contractsExecuted: 2, contractSignedAt: "2026-08-20" },
      "contract",
    );
    expect(c.met).toBe(true);
    expect(c.detail).toBe("2 contracts · 2026-08-20");
  });

  test("a single executed contract reads exactly as it did before", () => {
    const c = check(
      { ...fullyAwarded, contractsLive: 1, contractsExecuted: 1, contractSignedAt: "2026-08-20" },
      "contract",
    );
    expect(c.met).toBe(true);
    expect(c.detail).toBe("2026-08-20");
  });
});

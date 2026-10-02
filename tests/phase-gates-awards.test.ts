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
  preWalkAuditId: 1,
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
  bidsReturned: 0,
  scopeNotStartedCount: 0,
  scopeCompleteCount: 0,
  scopeTotalCount: 5,
  hasActualStart: false,
  punchWalkStatus: null,
  punchWalkAuditId: null,
  punchWalkDate: null,
  openFindingCount: 0,
  openFindingAuditId: null,
  postedGlTotal: 0,
};

/** One gate check out of the precon → in_process set. */
function check(over: Partial<typeof base>, key: "scope_bids" | "contract") {
  const result = evaluateGates("precon", "in_process", { ...base, ...over });
  return result.checks.find((c) => c.key === key)!;
}

/** Everything let to one vendor. */
const fullyAwarded = { awardCount: 1, hasApprovedBid: true, scopeLinesAwarded: 5 };
/** Everything let, split between two. */
const splitAwarded = { awardCount: 2, hasApprovedBid: true, scopeLinesAwarded: 5 };

describe("scopeBidsCheck", () => {
  test("pre-con is three gates now, scope and bids being one", () => {
    const result = evaluateGates("precon", "in_process", base);
    expect(result.checks.map((c) => c.key)).toEqual(["pre_walk", "scope_bids", "contract"]);
  });

  test("keeps one label while the detail carries the state", () => {
    expect(check({}, "scope_bids").label).toBe("Scope & Bids");
    expect(check(fullyAwarded, "scope_bids").label).toBe("Scope & Bids");
  });

  test("stays open while requests are out and nothing is awarded", () => {
    const c = check({}, "scope_bids");
    expect(c.met).toBe(false);
    expect(c.detail).toBe("2 out for bid");
    expect(c.waitingDays).toBe(3);
  });

  test("counts what has come back once anything has", () => {
    const c = check({ bidsReturned: 1 }, "scope_bids");
    expect(c.met).toBe(false);
    expect(c.short).toBe("Select bid");
    expect(c.detail).toBe("1 of 2 back");
  });

  test("an unsent, unconfirmed scope asks to be sent — there is no confirm step", () => {
    const c = check(
      { scopeConfirmedAt: null, bidsSent: 0, bidsOutstanding: 0, oldestSentDays: null },
      "scope_bids",
    );
    expect(c.met).toBe(false);
    expect(c.short).toBe("Send for pricing");
    expect(c.detail).toBe("5 lines drafted · $60,000");
  });

  test("a scope with no lines asks for one", () => {
    const c = check({ scopeLineCount: 0, bidsSent: 0, bidsOutstanding: 0 }, "scope_bids");
    expect(c.short).toBe("Write scope");
    expect(c.detail).toBe("No scope yet");
  });

  test("every request declined — get more bids", () => {
    const c = check({ bidsOutstanding: 0, oldestSentDays: null }, "scope_bids");
    expect(c.short).toBe("Get bids");
    expect(c.detail).toBe("No bids pending");
  });

  test("a partial award does not meet the gate", () => {
    const c = check({ awardCount: 1, hasApprovedBid: true, scopeLinesAwarded: 3 }, "scope_bids");
    expect(c.met).toBe(false);
    expect(c.short).toBe("Award the rest");
    expect(c.detail).toBe("3 of 5 lines awarded");
  });

  test("full coverage by one vendor meets it", () => {
    const c = check(fullyAwarded, "scope_bids");
    expect(c.met).toBe(true);
    expect(c.detail).toBe("Awarded");
  });

  test("full coverage split across two vendors meets it and says so", () => {
    const c = check(splitAwarded, "scope_bids");
    expect(c.met).toBe(true);
    expect(c.detail).toBe("2 vendors awarded");
  });

  test("a direct award covering everything meets it with no RFP ever sent", () => {
    const c = check(
      { ...fullyAwarded, directAward: true, bidsSent: 0, bidsOutstanding: 0 },
      "scope_bids",
    );
    expect(c.met).toBe(true);
    expect(c.detail).toBe("Assigned directly");
  });

  test("an empty scope cannot be fully awarded", () => {
    expect(check({ scopeLineCount: 0, scopeLinesAwarded: 0 }, "scope_bids").met).toBe(false);
  });

  test("full coverage without a confirmed scope is not met — it asks for the confirm", () => {
    // Awards confirm the scope now, so this is an award from before that did;
    // letting it through would advance a project whose scope is still open.
    const c = check({ ...fullyAwarded, scopeConfirmedAt: null }, "scope_bids");
    expect(c.met).toBe(false);
    expect(c.short).toBe("Confirm scope");
    expect(c.detail).toBe("Awarded · scope not confirmed");
  });

  test("hand-recorded bids that are back read as something to pick", () => {
    // They never go out through the portal, so nothing was "sent".
    const c = check({ bidsSent: 0, oldestSentDays: null, bidsOutstanding: 2, bidsReturned: 2 }, "scope_bids");
    expect(c.short).toBe("Select bid");
    expect(c.detail).toBe("2 of 2 back");
    expect(c.waitingDays).toBeUndefined();
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

/**
 * Pure-function tests for the board's Next Step column.
 *
 * `nextStep` is the one derivation behind that button, and it reads nothing but
 * what `evaluateGates` already decided — the point being that the board and the
 * project page's gate list cannot disagree about what a project is waiting on.
 *
 * Branches covered:
 *  - each pre-con gate in turn becoming the blocking one, in the order the work
 *    actually runs
 *  - the compact `short` label winning over the long `label` where one is set
 *  - every gate met, in each phase, producing the advance
 *  - the vendor wait riding along on the two gates that can stall on one
 *  - the later phases' keyless gates, which route to a screen instead of a
 *    dialog
 *  - the last phase, which has nothing to offer
 */
import { describe, expect, test } from "vitest";
import { evaluateGates, nextStep, type GateResult } from "@/lib/phase-gates";
import { PROJECT_PHASES, nextPhase } from "@/lib/stages";

/** A project at the very start of pre-con: nothing done at all. */
const fresh = {
  preWalkDate: null,
  preWalkAuditStatus: null,
  scopeLineCount: 0,
  scopeConfirmedAt: null,
  approvedBudget: 0,
  bidsSent: 0,
  oldestSentDays: null,
  directAward: false,
  contractOutDays: null,
  contractStatus: null,
  hasApprovedBid: false,
  awardCount: 0,
  scopeLinesAwarded: 0,
  contractsLive: 0,
  contractsExecuted: 0,
  contractSignedAt: null,
  bidsOutstanding: 0,
  hasStartMilestoneActual: false,
  openFindingCount: 0,
  postedGlTotal: 0,
};

/** Walked, scoped, confirmed, budgeted — pre-con gates 1 and 2 met. */
const scoped = {
  ...fresh,
  preWalkAuditStatus: "complete" as const,
  preWalkDate: "2026-08-01",
  scopeLineCount: 5,
  scopeConfirmedAt: new Date("2026-08-02"),
  approvedBudget: 60_000,
};

/** ...and out for bid. */
const outForBid = { ...scoped, bidsSent: 3, bidsOutstanding: 3, oldestSentDays: 6 };

/** ...and fully awarded to one vendor. */
const awarded = {
  ...outForBid,
  bidsOutstanding: 0,
  awardCount: 1,
  hasApprovedBid: true,
  scopeLinesAwarded: 5,
};

/** Every pre-con gate met. */
const preconDone = { ...awarded, contractSignedAt: "2026-08-20" };

function stepFrom(
  phase: "precon" | "in_process" | "punch" | "complete",
  data: typeof fresh,
) {
  const upcoming = nextPhase(phase);
  const gate: GateResult | null = upcoming
    ? evaluateGates(phase, upcoming.key, data)
    : null;
  return nextStep(gate, upcoming);
}

describe("pre-con walks its gates in order", () => {
  test("nothing done — schedule the walk", () => {
    expect(stepFrom("precon", fresh)).toEqual({
      kind: "goto",
      label: "Schedule pre-walk",
      gate: "pre_walk",
      target: "workflow",
    });
  });

  test("walk booked but not done — do it", () => {
    const step = stepFrom("precon", { ...fresh, preWalkDate: "2026-08-01" });
    expect(step).toMatchObject({ kind: "goto", gate: "pre_walk", label: "Do pre-walk" });
  });

  test("walk in progress — finish it", () => {
    const step = stepFrom("precon", {
      ...fresh,
      preWalkDate: "2026-08-01",
      preWalkAuditStatus: "draft",
    });
    expect(step).toMatchObject({ kind: "goto", gate: "pre_walk", label: "Finish pre-walk" });
  });

  test("walked, no scope yet — write one", () => {
    const step = stepFrom("precon", { ...fresh, preWalkAuditStatus: "complete" });
    expect(step).toMatchObject({ kind: "goto", gate: "scope", label: "Write scope" });
  });

  test("scope drafted but unconfirmed — confirm it", () => {
    const step = stepFrom("precon", {
      ...fresh,
      preWalkAuditStatus: "complete",
      scopeLineCount: 5,
      approvedBudget: 60_000,
    });
    // The long label is "Confirm Scope & Budget"; the column gets the short one.
    expect(step).toMatchObject({ kind: "goto", gate: "scope", label: "Confirm scope" });
  });

  test("scope confirmed — send the RFP", () => {
    expect(stepFrom("precon", scoped)).toMatchObject({
      kind: "goto",
      gate: "rfp",
      label: "Send RFP",
    });
  });

  test("out for bid — select one, and say how long the wait has been", () => {
    expect(stepFrom("precon", outForBid)).toEqual({
      kind: "goto",
      label: "Select bid",
      gate: "bid",
      target: "workflow",
      waitingDays: 6,
    });
  });

  test("partially awarded — award the rest", () => {
    const step = stepFrom("precon", { ...awarded, scopeLinesAwarded: 2 });
    expect(step).toMatchObject({ kind: "goto", gate: "bid", label: "Award the rest" });
  });

  test("awarded, no contract — generate it", () => {
    expect(stepFrom("precon", awarded)).toMatchObject({
      kind: "goto",
      gate: "contract",
      label: "Generate contract",
    });
  });

  test("contract drafted — send it for signature", () => {
    const step = stepFrom("precon", { ...awarded, contractStatus: "draft", contractsLive: 1 });
    expect(step).toMatchObject({ kind: "goto", gate: "contract", label: "Send for signature" });
  });

  test("out for signature — the wait belongs to the vendor", () => {
    const step = stepFrom("precon", {
      ...awarded,
      contractStatus: "out_for_signature",
      contractsLive: 1,
      contractOutDays: 2,
    });
    expect(step).toMatchObject({
      kind: "goto",
      gate: "contract",
      label: "Awaiting signature",
      waitingDays: 2,
    });
  });

  test("all five met — the step is the advance itself", () => {
    expect(stepFrom("precon", preconDone)).toEqual({
      kind: "advance",
      label: "Advance to In Process",
      toPhase: "in_process",
    });
  });
});

describe("the later phases", () => {
  test("in process without an actual start — record it", () => {
    const step = stepFrom("in_process", preconDone);
    // No gate key: there is no dialog for this one, so it routes to the
    // workflow tab where the milestone's date is edited.
    expect(step).toEqual({
      kind: "goto",
      label: "Record start date",
      target: "workflow",
    });
  });

  test("in process with a start date — advance to punch", () => {
    const step = stepFrom("in_process", { ...preconDone, hasStartMilestoneActual: true });
    expect(step).toEqual({
      kind: "advance",
      label: "Advance to Punch and Sign Off",
      toPhase: "punch",
    });
  });

  test("punch with open findings — resolve them, at the audit", () => {
    const step = stepFrom("punch", { ...preconDone, openFindingCount: 2, postedGlTotal: 5_000 });
    expect(step).toEqual({
      kind: "goto",
      label: "Resolve 2 findings",
      target: "audits",
    });
  });

  test("one finding is singular", () => {
    const step = stepFrom("punch", { ...preconDone, openFindingCount: 1, postedGlTotal: 5_000 });
    expect(step).toMatchObject({ label: "Resolve 1 finding" });
  });

  test("punch, findings clear, no GL — post the actuals, at the ledger", () => {
    const step = stepFrom("punch", preconDone);
    expect(step).toEqual({
      kind: "goto",
      label: "Post GL actuals",
      target: "gl",
    });
  });

  test("punch fully met — advance to complete", () => {
    const step = stepFrom("punch", { ...preconDone, postedGlTotal: 5_000 });
    expect(step).toMatchObject({ kind: "advance", toPhase: "complete" });
  });

  test("complete has nothing left to offer", () => {
    expect(stepFrom("complete", preconDone)).toEqual({ kind: "none" });
  });
});

describe("nextStep's own contract", () => {
  test("no upcoming phase always means none, whatever the gates say", () => {
    expect(nextStep(null, null)).toEqual({ kind: "none" });
  });

  test("no gate result means the advance — a transition with no checks", () => {
    expect(nextStep(null, { key: "punch", label: "Punch and Sign Off" })).toEqual({
      kind: "advance",
      label: "Advance to Punch and Sign Off",
      toPhase: "punch",
    });
  });

  test("every phase but the last offers something", () => {
    for (const phase of PROJECT_PHASES) {
      const step = stepFrom(phase.key, fresh);
      if (phase.key === "complete") expect(step.kind).toBe("none");
      else expect(step.kind).not.toBe("none");
    }
  });
});

describe("evaluateGates marks the blocking check in every phase", () => {
  // It used to mark `next` only in pre-con, so the later phases had no answer to
  // "what is this waiting on" — which is exactly what the board asks.
  test.each(["in_process", "punch"] as const)("%s marks its first unmet gate", (phase) => {
    const upcoming = nextPhase(phase)!;
    const result = evaluateGates(phase, upcoming.key, fresh);
    expect(result.checks.filter((c) => c.next)).toHaveLength(1);
    expect(result.checks.find((c) => c.next)!.met).toBe(false);
  });

  test("a fully met phase marks nothing", () => {
    const result = evaluateGates("precon", "in_process", preconDone);
    expect(result.allMet).toBe(true);
    expect(result.checks.some((c) => c.next)).toBe(false);
  });
});

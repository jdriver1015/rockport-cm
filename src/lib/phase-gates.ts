import type { ProjectPhaseKey } from "@/lib/stages";

/**
 * The pre-con gates, in the order the work actually happens: walk the unit,
 * write the scope from what the walk found, then bid it.
 *
 * These are the only gates with a key, because they are the only ones a person
 * resolves by clicking something. The later transitions check on-site progress,
 * which no dialog can fix.
 */
export const PRECON_GATE_KEYS = ["pre_walk", "scope", "rfp", "bid", "contract"] as const;
export type PreconGateKey = (typeof PRECON_GATE_KEYS)[number];

export type GateCheck = {
  /** Present when the gate has an action behind it. */
  key?: PreconGateKey;
  /**
   * The first unmet gate — the thing to do next. Emphasised in the UI so the
   * row reads as a queue rather than four equal buttons.
   */
  next?: boolean;
  /**
   * Days this gate has been waiting on somebody outside the company. Only the
   * two that can stall on a vendor set it — that is where turns actually go
   * late, and it is invisible everywhere else in the app.
   */
  waitingDays?: number;
  /**
   * Reads as the current state rather than the requirement — "Pre-Walk
   * Scheduled" once a date is set, not "Schedule Pre-Walk" — so the row doubles
   * as a status.
   */
  label: string;
  /**
   * The same requirement in as few words as a table column can hold, for the
   * board's Next Step button. Set alongside `label` rather than mapped from it
   * afterwards: the state and its two spellings are one decision, and deriving
   * one from the other by string match would break the first time a label was
   * reworded. Absent where `label` is already short enough.
   */
  short?: string;
  met: boolean;
  detail: string;
};

export type GateResult = {
  fromPhase: ProjectPhaseKey;
  toPhase: ProjectPhaseKey;
  checks: GateCheck[];
  allMet: boolean;
  metCount: number;
};

/** What the pre-con gates read. Every field is state the project already holds. */
export type PreconGateState = {
  /** projects.pre_walk_date — the walk is on the calendar. */
  preWalkDate: string | null;
  /** The linked pre-walk audit's status, or null when no walk exists yet. */
  preWalkAuditStatus: "draft" | "complete" | null;
  scopeLineCount: number;
  /** projects.scope_confirmed_at — the scope is agreed and ready to price. */
  scopeConfirmedAt: Date | null;
  /** The approved budget. Zero means none has been set. */
  approvedBudget: number;
  /** Any bid has left the building — status past draft, so an RFP went out. */
  bidsSent: number;
  /** The oldest live request, in days. Null when nothing is out. */
  oldestSentDays: number | null;
  /** The award was made without competition, so there was never an RFP. */
  directAward: boolean;
  /** Days since the contract went out for signature. Null when it has not. */
  contractOutDays: number | null;
  /** The live contract's status, or null when none has been generated. */
  contractStatus: string | null;
  /** A non-archived bid on this project with approved = true. */
  hasApprovedBid: boolean;
  /** Approved bids. A split job has one per vendor. */
  awardCount: number;
  /** Scope lines an approved bid covers — the job is let when this is all of them. */
  scopeLinesAwarded: number;
  /** Non-voided contracts, and how many of them are executed. */
  contractsLive: number;
  contractsExecuted: number;
  /** Bids sent and not yet returned — progress while none is approved. */
  bidsOutstanding: number;
  /** projects.contract_signed_at */
  contractSignedAt: string | null;
};

/** The rest of what the later transitions check. */
export type ProgressGateState = {
  /**
   * An actual start has been recorded — from EITHER projects.start_date or the
   * in_process milestone's actual_date.
   *
   * Both record the same fact and only one path writes both. setProjectPhase
   * stamps the pair, but a project that arrived in In Process any other way — an
   * import, a seed, a phase set before milestones existed — has the column and
   * not the milestone. Reading only the milestone made this gate unmet for 11 of
   * the 13 in-process projects in the portfolio, every one of which had a real
   * start date on it, and the board's Next Step told all 11 to go and record a
   * date they had already recorded.
   */
  hasActualStart: boolean;
  openFindingCount: number;
  postedGlTotal: number;
};

/**
 * The pre-walk's states.
 *
 * The gate is met at complete, not at scheduled: a booked walk nobody has done
 * tells you nothing about the unit, and the scope is written from what the walk
 * found.
 */
function preWalkCheck(state: PreconGateState): GateCheck {
  if (state.preWalkAuditStatus === "complete") {
    return { key: "pre_walk", label: "Pre-Walk Complete", met: true, detail: "Walked" };
  }
  if (state.preWalkAuditStatus === "draft") {
    return {
      key: "pre_walk",
      label: "Pre-Walk Started",
      short: "Finish pre-walk",
      met: false,
      detail: "Walk in progress",
    };
  }
  if (state.preWalkDate) {
    return {
      key: "pre_walk",
      label: "Pre-Walk Scheduled",
      short: "Do pre-walk",
      met: false,
      detail: state.preWalkDate,
    };
  }
  return {
    key: "pre_walk",
    label: "Schedule Pre-Walk",
    short: "Schedule pre-walk",
    met: false,
    detail: "Not scheduled",
  };
}

/**
 * The scope is no longer its own gate.
 *
 * You cannot send an RFP without scope — sendBidPackageRows refuses an empty
 * selection — so "RFP Sent" already implies it. Keeping both would have been two
 * rows for one fact, and the design's four are the four that move independently.
 */
/**
 * The scope is agreed, and there is a budget to measure the bids against.
 *
 * Both, because they are one decision: a list of work nobody has priced a limit
 * for tells you nothing when the bids come back. A count of lines is also not
 * the same as somebody having looked at them, which is why this is a stamped
 * date and not `scopeLineCount > 0`. It is the gate that makes the scope lock
 * legible too: confirming is the last free edit.
 */
function scopeCheck(state: PreconGateState): GateCheck {
  const lines = `${state.scopeLineCount} line${state.scopeLineCount === 1 ? "" : "s"}`;
  const money = `$${Math.round(state.approvedBudget).toLocaleString()}`;

  if (state.scopeConfirmedAt) {
    return { key: "scope", label: "Scope & Budget Set", met: true, detail: `${lines} · ${money}` };
  }
  if (state.scopeLineCount === 0) {
    return {
      key: "scope",
      label: "Confirm Scope & Budget",
      short: "Write scope",
      met: false,
      detail: "No scope yet",
    };
  }
  return {
    key: "scope",
    label: "Confirm Scope & Budget",
    short: "Confirm scope",
    met: false,
    detail: state.approvedBudget > 0 ? `${lines} drafted · ${money}` : `${lines} · no budget set`,
  };
}

function rfpCheck(state: PreconGateState): GateCheck {
  // A direct award never had a request, and never should have. The gate is met
  // by the decision not to compete, not by pretending one went out.
  if (state.directAward) {
    return { key: "rfp", label: "Direct Award", met: true, detail: "No bid required" };
  }
  if (state.bidsSent > 0) {
    return {
      key: "rfp",
      label: "RFP Sent",
      met: true,
      detail: `${state.bidsSent} vendor${state.bidsSent === 1 ? "" : "s"}`,
    };
  }
  return {
    key: "rfp",
    label: "Send RFP",
    short: "Send RFP",
    met: false,
    detail: state.scopeConfirmedAt ? "Not sent" : "Confirm the scope first",
  };
}

function contractCheck(state: PreconGateState): GateCheck {
  if (state.contractSignedAt) {
    return {
      key: "contract",
      label: "Contract Signed",
      met: true,
      detail:
        state.awardCount > 1
          ? `${state.awardCount} contracts · ${state.contractSignedAt}`
          : state.contractSignedAt,
    };
  }
  // An award with no document yet is a different problem from a document waiting
  // on a signature, and on a split job both can be true at once. The ungenerated
  // one is ours to fix, so it is what the gate asks for first.
  if (state.awardCount > 1 && state.contractsLive < state.awardCount) {
    return {
      key: "contract",
      label: "Sign Contract",
      short: "Generate contracts",
      met: false,
      detail: `${state.contractsLive} of ${state.awardCount} contracts generated`,
    };
  }
  // Out for signature is its own state, the same way "out for bid" is: the work
  // is done on our side and the wait belongs to somebody else.
  if (state.contractOutDays != null) {
    return {
      key: "contract",
      label: state.contractStatus === "vendor_signed" ? "Awaiting Countersign" : "Out for Signature",
      short: state.contractStatus === "vendor_signed" ? "Countersign" : "Awaiting signature",
      met: false,
      detail:
        state.awardCount > 1
          ? `${state.contractsExecuted} of ${state.awardCount} executed`
          : state.contractStatus === "vendor_signed"
            ? "Vendor has signed"
            : "Sent to the vendor",
      waitingDays: state.contractOutDays,
    };
  }
  // A generated draft nobody has sent is a different problem from no contract
  // at all, and the difference is whose desk it is on.
  if (state.contractStatus === "draft") {
    return {
      key: "contract",
      label: "Send for Signature",
      short: "Send for signature",
      met: false,
      detail: "Draft ready",
    };
  }
  return {
    key: "contract",
    label: "Sign Contract",
    short: state.hasApprovedBid ? "Generate contract" : "Sign contract",
    met: false,
    detail: state.hasApprovedBid ? "Ready to generate" : "Awaiting a selected bid",
  };
}

function bidCheck(state: PreconGateState): GateCheck {
  // Coverage, not "is anything awarded". A project may let siding to one sub and
  // roofing to another, so the gate is met when every line has somebody on it —
  // a partial award used to satisfy this and let a phase advance with work
  // nobody was contracted for.
  const fullyAwarded =
    state.scopeLineCount > 0 && state.scopeLinesAwarded >= state.scopeLineCount;

  if (fullyAwarded) {
    return {
      key: "bid",
      label: "Bid Selected",
      met: true,
      detail:
        state.awardCount > 1
          ? `${state.awardCount} vendors awarded`
          : state.directAward
            ? "Assigned directly"
            : "Awarded",
    };
  }
  if (state.scopeLinesAwarded > 0) {
    return {
      key: "bid",
      label: "Award the Rest",
      short: "Award the rest",
      met: false,
      detail: `${state.scopeLinesAwarded} of ${state.scopeLineCount} lines awarded`,
    };
  }
  if (state.bidsOutstanding > 0) {
    return {
      key: "bid",
      label: "Select Bid",
      short: "Select bid",
      met: false,
      detail: `${state.bidsOutstanding} out for bid`,
      // Waiting on the vendors, not on us.
      ...(state.oldestSentDays != null ? { waitingDays: state.oldestSentDays } : {}),
    };
  }
  return {
    key: "bid",
    label: "Select Bid",
    short: "Get bids",
    met: false,
    detail: "Nothing out for bid",
  };
}

/**
 * Evaluate the gate checks for advancing from one phase to another.
 *
 * Pre-con's five are actionable and strictly ordered: walk the unit, write and
 * confirm the scope from what the walk found, send it out, pick a price, sign
 * for it. Each one is a thing a person resolves by clicking something, which is
 * what separates them from the later phases' checks — those watch on-site
 * progress that no dialog can fix.
 */
export function evaluateGates(
  fromPhase: ProjectPhaseKey,
  toPhase: ProjectPhaseKey,
  data: PreconGateState & ProgressGateState,
): GateResult {
  let checks: GateCheck[];

  if (fromPhase === "precon" && toPhase === "in_process") {
    checks = [
      preWalkCheck(data),
      scopeCheck(data),
      rfpCheck(data),
      bidCheck(data),
      contractCheck(data),
    ];
  } else if (fromPhase === "in_process" && toPhase === "punch") {
    checks = [
      // "All scope lines started" used to sit here, off a per-line status field
      // that has been removed — tracking each line's progress separately from the
      // project's phase was two answers to one question. Left at one check rather
      // than replaced with a stand-in: punch_items is the honest source for the
      // later gate and has no UI yet.
      {
        label: "In Process date recorded",
        short: "Record start date",
        met: data.hasActualStart,
        detail: data.hasActualStart ? "Recorded" : "No actual start date",
      },
    ];
  } else if (fromPhase === "punch" && toPhase === "complete") {
    checks = [
      {
        label: "No open audit findings",
        short:
          data.openFindingCount === 1
            ? "Resolve 1 finding"
            : `Resolve ${data.openFindingCount} findings`,
        met: data.openFindingCount === 0,
        detail:
          data.openFindingCount === 0
            ? "All clear"
            : `${data.openFindingCount} open finding${data.openFindingCount === 1 ? "" : "s"}`,
      },
      // "All scope lines complete" used to sit here. Same removal — and this is
      // the gate stages.ts defines as "All punch items resolved", so that is what
      // should take its place once punch items are built.
      {
        label: "GL actuals posted",
        short: "Post GL actuals",
        met: data.postedGlTotal > 0,
        detail:
          data.postedGlTotal > 0
            ? `$${Math.round(data.postedGlTotal).toLocaleString()} posted`
            : "No posted GL",
      },
    ];
  } else {
    checks = [];
  }

  // The first unmet gate is the next thing to do. Marking it here rather than in
  // the component keeps "what is next" one definition instead of two — and it is
  // now marked in EVERY phase, not just pre-con. The later phases' checks have
  // no dialog behind them, but they are still the answer to "what is this
  // project waiting on", which is what the board's Next Step column asks.
  const firstUnmet = checks.findIndex((c) => !c.met);
  if (firstUnmet !== -1) checks[firstUnmet] = { ...checks[firstUnmet], next: true };

  const metCount = checks.filter((c) => c.met).length;
  return {
    fromPhase,
    toPhase,
    checks,
    allMet: checks.length === 0 || metCount === checks.length,
    metCount,
  };
}

// ---------------------------------------------------------------------------
// What to do next, as one thing a person can press.
// ---------------------------------------------------------------------------

/**
 * The single next action on a project, for the board's Next Step column.
 *
 * Three shapes, because there are three honestly different situations:
 *
 *  - `advance` — every gate is met, so the next step finishes in one press
 *    without leaving the row. The server re-checks the gates in
 *    checkPhaseAdvance, so this cannot skip one however stale the page is.
 *  - `goto` — there is work to do somewhere else. Pre-con's gates each name the
 *    dialog that resolves them; the later phases' gates name the screen where
 *    the work happens, because no dialog can fix an open finding.
 *  - `none` — the project is in its last phase. Nothing to offer.
 */
export type NextStep =
  | { kind: "advance"; label: string; toPhase: ProjectPhaseKey }
  | {
      kind: "goto";
      label: string;
      /** Opens this gate's dialog on arrival. Absent on the non-pre-con gates. */
      gate?: PreconGateKey;
      target: "workflow" | "audits" | "gl";
      waitingDays?: number;
    }
  | { kind: "none" };

/** Where a gate with no dialog sends you instead. */
function targetForCheck(check: GateCheck): "workflow" | "audits" | "gl" {
  if (check.key) return "workflow";
  if (check.label === "No open audit findings") return "audits";
  if (check.label === "GL actuals posted") return "gl";
  return "workflow";
}

/**
 * Turn a phase's gate result into the one step to offer.
 *
 * Pure, and reading only what `evaluateGates` already decided — so the board's
 * button and the project page's gate list cannot disagree about what is next.
 * `upcoming` is null in the last phase.
 */
export function nextStep(
  gate: GateResult | null,
  upcoming: { key: ProjectPhaseKey; label: string; short?: string } | null,
): NextStep {
  if (!upcoming) return { kind: "none" };
  // The compact phase name, for the same reason the gates have a `short`: this
  // label lives in a table column, and "Advance to Punch and Sign Off" does not
  // fit one. The project page's own advance button keeps the full name.
  const advance = (): NextStep => ({
    kind: "advance",
    label: `Advance to ${upcoming.short ?? upcoming.label}`,
    toPhase: upcoming.key,
  });

  if (!gate) return advance();

  const blocking = gate.checks.find((c) => c.next);
  if (!blocking) return advance();

  return {
    kind: "goto",
    label: blocking.short ?? blocking.label,
    ...(blocking.key ? { gate: blocking.key } : {}),
    target: targetForCheck(blocking),
    ...(blocking.waitingDays != null ? { waitingDays: blocking.waitingDays } : {}),
  };
}

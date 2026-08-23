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
  /** Bids sent and not yet returned — progress while none is approved. */
  bidsOutstanding: number;
  /** projects.contract_signed_at */
  contractSignedAt: string | null;
};

/** The rest of what the later transitions check. */
export type ProgressGateState = {
  scopeNotStartedCount: number;
  scopeCompleteCount: number;
  scopeTotalCount: number;
  hasStartMilestoneActual: boolean;
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
    return { key: "pre_walk", label: "Pre-Walk Started", met: false, detail: "Walk in progress" };
  }
  if (state.preWalkDate) {
    return { key: "pre_walk", label: "Pre-Walk Scheduled", met: false, detail: state.preWalkDate };
  }
  return { key: "pre_walk", label: "Schedule Pre-Walk", met: false, detail: "Not scheduled" };
}

/**
 * The scope is no longer its own gate.
 *
 * You cannot send an RFP without scope — sendBidPackageRows refuses an empty
 * selection — so "RFP Sent" already implies it. Keeping both would have been two
 * rows for one fact, and the design's four are the four that move independently.
 */
/**
 * The scope is agreed and ready to price.
 *
 * A count of lines is not the same as somebody having looked at them, which is
 * why this is a stamped date and not `scopeLineCount > 0`. It is also the gate
 * that makes the scope lock legible: confirming is the last free edit.
 */
function scopeCheck(state: PreconGateState): GateCheck {
  if (state.scopeConfirmedAt) {
    return {
      key: "scope",
      label: "Scope Confirmed",
      met: true,
      detail: `${state.scopeLineCount} line${state.scopeLineCount === 1 ? "" : "s"}`,
    };
  }
  return {
    key: "scope",
    label: "Confirm Scope",
    met: false,
    detail:
      state.scopeLineCount > 0
        ? `${state.scopeLineCount} line${state.scopeLineCount === 1 ? "" : "s"} drafted`
        : "No scope yet",
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
    met: false,
    detail: state.scopeConfirmedAt ? "Not sent" : "Confirm the scope first",
  };
}

function contractCheck(state: PreconGateState): GateCheck {
  if (state.contractSignedAt) {
    return { key: "contract", label: "Contract Signed", met: true, detail: state.contractSignedAt };
  }
  // Out for signature is its own state, the same way "out for bid" is: the work
  // is done on our side and the wait belongs to somebody else.
  if (state.contractOutDays != null) {
    return {
      key: "contract",
      label: state.contractStatus === "vendor_signed" ? "Awaiting Countersign" : "Out for Signature",
      met: false,
      detail: state.contractStatus === "vendor_signed" ? "Vendor has signed" : "Sent to the vendor",
      waitingDays: state.contractOutDays,
    };
  }
  // A generated draft nobody has sent is a different problem from no contract
  // at all, and the difference is whose desk it is on.
  if (state.contractStatus === "draft") {
    return { key: "contract", label: "Send for Signature", met: false, detail: "Draft ready" };
  }
  return {
    key: "contract",
    label: "Sign Contract",
    met: false,
    detail: state.hasApprovedBid ? "Ready to generate" : "Awaiting a selected bid",
  };
}

function bidCheck(state: PreconGateState): GateCheck {
  if (state.hasApprovedBid) {
    return {
      key: "bid",
      label: "Bid Selected",
      met: true,
      detail: state.directAward ? "Assigned directly" : "Awarded",
    };
  }
  if (state.bidsOutstanding > 0) {
    return {
      key: "bid",
      label: "Select Bid",
      met: false,
      detail: `${state.bidsOutstanding} out for bid`,
      // Waiting on the vendors, not on us.
      ...(state.oldestSentDays != null ? { waitingDays: state.oldestSentDays } : {}),
    };
  }
  return { key: "bid", label: "Select Bid", met: false, detail: "Nothing out for bid" };
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
    // The first unmet gate is the next thing to do. Marking it here rather than
    // in the component keeps "what is next" one definition instead of two.
    const firstUnmet = checks.findIndex((c) => !c.met);
    if (firstUnmet !== -1) checks[firstUnmet] = { ...checks[firstUnmet], next: true };
  } else if (fromPhase === "in_process" && toPhase === "punch") {
    checks = [
      {
        label: "All scope lines started",
        met: data.scopeNotStartedCount === 0,
        detail:
          data.scopeNotStartedCount === 0
            ? "All started"
            : `${data.scopeNotStartedCount} not started`,
      },
      {
        label: "In Process date recorded",
        met: data.hasStartMilestoneActual,
        detail: data.hasStartMilestoneActual ? "Recorded" : "No actual start date",
      },
    ];
  } else if (fromPhase === "punch" && toPhase === "complete") {
    checks = [
      {
        label: "No open audit findings",
        met: data.openFindingCount === 0,
        detail:
          data.openFindingCount === 0
            ? "All clear"
            : `${data.openFindingCount} open finding${data.openFindingCount === 1 ? "" : "s"}`,
      },
      {
        label: "All scope lines complete",
        met: data.scopeCompleteCount === data.scopeTotalCount && data.scopeTotalCount > 0,
        detail:
          data.scopeTotalCount === 0
            ? "No scope lines"
            : `${data.scopeCompleteCount} of ${data.scopeTotalCount} complete`,
      },
      {
        label: "GL actuals posted",
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

  const metCount = checks.filter((c) => c.met).length;
  return {
    fromPhase,
    toPhase,
    checks,
    allMet: checks.length === 0 || metCount === checks.length,
    metCount,
  };
}

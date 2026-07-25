import type { ProjectPhaseKey } from "@/lib/stages";

export type GateCheck = {
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

/**
 * Evaluate the gate checks for advancing from one phase to another.
 * Each transition has its own set of requirements. The checks are soft —
 * a PM can override with a note explaining why.
 */
export function evaluateGates(
  fromPhase: ProjectPhaseKey,
  toPhase: ProjectPhaseKey,
  data: {
    scopeLineCount: number;
    budgetAmount: number;
    committedCost: number;
    vendorAssigned: boolean;
    scopeNotStartedCount: number;
    scopeCompleteCount: number;
    scopeTotalCount: number;
    hasStartMilestoneActual: boolean;
    openFindingCount: number;
    postedGlTotal: number;
  },
): GateResult {
  let checks: GateCheck[];

  if (fromPhase === "precon" && toPhase === "in_process") {
    checks = [
      {
        label: "Scope defined",
        met: data.scopeLineCount > 0,
        detail: data.scopeLineCount > 0
          ? `${data.scopeLineCount} scope line${data.scopeLineCount === 1 ? "" : "s"}`
          : "No scope lines",
      },
      {
        label: "Budget set",
        met: data.budgetAmount > 0,
        detail: data.budgetAmount > 0 ? `$${Math.round(data.budgetAmount).toLocaleString()}` : "No budget",
      },
      {
        label: "Committed cost or approved bid",
        met: data.committedCost > 0,
        detail: data.committedCost > 0
          ? `$${Math.round(data.committedCost).toLocaleString()} committed`
          : "No committed cost",
      },
      {
        label: "Vendor assigned",
        met: data.vendorAssigned,
        detail: data.vendorAssigned ? "Assigned" : "No vendor",
      },
    ];
  } else if (fromPhase === "in_process" && toPhase === "punch") {
    checks = [
      {
        label: "All scope lines started",
        met: data.scopeNotStartedCount === 0,
        detail: data.scopeNotStartedCount === 0
          ? "All started"
          : `${data.scopeNotStartedCount} not started`,
      },
      {
        label: "Start milestone recorded",
        met: data.hasStartMilestoneActual,
        detail: data.hasStartMilestoneActual ? "Recorded" : "No actual start date",
      },
    ];
  } else if (fromPhase === "punch" && toPhase === "complete") {
    checks = [
      {
        label: "No open audit findings",
        met: data.openFindingCount === 0,
        detail: data.openFindingCount === 0
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
        detail: data.postedGlTotal > 0
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

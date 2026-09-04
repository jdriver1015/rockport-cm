/**
 * What each kind of project is called where a person reads it.
 *
 * Not a phase, but the same kind of fact: one spelling, in one place, so a
 * heading, a table cell and a search index cannot drift apart. `kind` decides
 * how a project's scope is priced and nothing after that — see the wizards.
 */
export const KIND_LABEL: Record<string, string> = {
  unit: "Unit interior",
  common: "Common area",
};

/**
 * The four operational phases a project moves through. Collapsed from the
 * original eight-stage system — planned/bidding/ready → precon,
 * in_progress → in_process, punch stays, complete/invoiced/closed → complete.
 */
export const PROJECT_PHASES = [
  { key: "precon", label: "Pre-Construction", short: "Pre-Con", gate: "Scoped, budgeted, contracted, vendor assigned" },
  { key: "in_process", label: "In Process", short: "In Process", gate: "Work substantially complete" },
  // "Advance to Punch and Sign Off" was clipped in the board's Next Step column
  // at 187px. Only this phase's name is long enough to need a compact form, but
  // all four carry one so no caller has to know which.
  { key: "punch", label: "Punch and Sign Off", short: "Punch", gate: "All punch items resolved" },
  { key: "complete", label: "Complete", short: "Complete", gate: "Costs posted and reconciled" },
] as const;

export type ProjectPhaseKey = (typeof PROJECT_PHASES)[number]["key"];

export function phaseIndex(key: string): number {
  return PROJECT_PHASES.findIndex((p) => p.key === key);
}

export function phaseLabel(key: string): string {
  return PROJECT_PHASES.find((p) => p.key === key)?.label ?? key;
}

export function nextPhase(key: string) {
  const i = phaseIndex(key);
  return i >= 0 && i < PROJECT_PHASES.length - 1 ? PROJECT_PHASES[i + 1] : null;
}

/** The phase before this one, or null at the start. Reopening moves here. */
export function prevPhase(key: string) {
  const i = phaseIndex(key);
  return i > 0 ? PROJECT_PHASES[i - 1] : null;
}

/** Map legacy 8-stage keys to the 4-phase model. */
const STAGE_TO_PHASE: Record<string, ProjectPhaseKey> = {
  planned: "precon",
  bidding: "precon",
  ready: "precon",
  in_progress: "in_process",
  punch: "punch",
  complete: "complete",
  invoiced: "complete",
  closed: "complete",
};

export function stageToPhase(stage: string): ProjectPhaseKey {
  return STAGE_TO_PHASE[stage] ?? "complete";
}

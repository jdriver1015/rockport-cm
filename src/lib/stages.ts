export const PROJECT_STAGES = [
  { key: "setup", label: "Setup", gate: "Budget loaded by cost code; unit inventory in" },
  { key: "bidding", label: "Bidding", gate: "Bids entered per scope; vendors selected" },
  { key: "mobilization", label: "Mobilization", gate: "Contracts committed; start dates set" },
  { key: "in_progress", label: "In Progress", gate: "GL intake running; scopes and turns tracked" },
  { key: "punch_walk", label: "Punch Walk", gate: "Walk checklist complete with photos" },
  { key: "final_completion", label: "Final Completion", gate: "Punch cleared; final invoices posted" },
  { key: "closed", label: "Closed", gate: "Budget reconciled; final report exported" },
] as const;

export type ProjectStageKey = (typeof PROJECT_STAGES)[number]["key"];

export function stageIndex(key: string): number {
  return PROJECT_STAGES.findIndex((s) => s.key === key);
}

export function stageLabel(key: string): string {
  return PROJECT_STAGES.find((s) => s.key === key)?.label ?? key;
}

export function nextStage(key: string) {
  const i = stageIndex(key);
  return i >= 0 && i < PROJECT_STAGES.length - 1 ? PROJECT_STAGES[i + 1] : null;
}

export const TURN_STAGES = [
  { key: "planned", label: "Planned" },
  { key: "vacant_ready", label: "Vacant / Ready" },
  { key: "in_progress", label: "In Progress" },
  { key: "punch", label: "Punch" },
  { key: "complete", label: "Complete" },
  { key: "invoiced", label: "Invoiced" },
  { key: "leased", label: "Leased" },
] as const;

export const PROJECT_STAGES = [
  { key: "planned", label: "Planned", gate: "Scoped with a budget amount" },
  { key: "bidding", label: "Bidding", gate: "Bids collected; vendor selected" },
  { key: "ready", label: "Ready", gate: "Contract committed / unit vacant, scheduled" },
  { key: "in_progress", label: "In Progress", gate: "Work started; photos as trades finish" },
  { key: "punch", label: "Punch", gate: "Punch walk done; items logged with photos" },
  { key: "complete", label: "Complete", gate: "All punch items resolved" },
  { key: "invoiced", label: "Invoiced", gate: "All costs posted from GL" },
  { key: "closed", label: "Closed", gate: "Reconciled to budget" },
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

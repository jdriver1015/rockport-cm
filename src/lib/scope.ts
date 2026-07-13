export const SCOPE_STATUSES = [
  { key: "planned", label: "Planned" },
  { key: "ordered", label: "Ordered" },
  { key: "installed", label: "Installed" },
  { key: "complete", label: "Complete" },
] as const;

export type ScopeStatusKey = (typeof SCOPE_STATUSES)[number]["key"];

export const SCOPE_STATUS_KEYS = SCOPE_STATUSES.map((s) => s.key) as ScopeStatusKey[];

export function scopeStatusLabel(key: string): string {
  return SCOPE_STATUSES.find((s) => s.key === key)?.label ?? key;
}

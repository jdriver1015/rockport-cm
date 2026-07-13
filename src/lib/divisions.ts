export const DIVISIONS = [
  { key: "exterior", label: "Exterior" },
  { key: "amenities", label: "Amenities" },
  { key: "interiors", label: "Interiors" },
  { key: "fees", label: "Fees" },
] as const;

export type DivisionKey = (typeof DIVISIONS)[number]["key"];

export const DIVISION_KEYS = DIVISIONS.map((d) => d.key) as DivisionKey[];

export function divisionLabel(key: string | null | undefined): string {
  if (!key) return "Unassigned";
  return DIVISIONS.find((d) => d.key === key)?.label ?? key;
}

/** Default bucket for a 4-digit category code, used to backfill/seed divisions. */
export function divisionForCode(code: string): DivisionKey | null {
  const n = parseInt(code, 10);
  if (Number.isNaN(n)) return null;
  if (n >= 4000) return "interiors";
  if (n >= 3000) return "fees";
  if (n >= 1600) return "amenities";
  if (n >= 1000) return "exterior";
  return null;
}

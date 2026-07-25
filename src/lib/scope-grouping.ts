import { SCOPE_SECTIONS } from "@/lib/scope-sections";
import { rollUpScope, type ScopeProgress } from "@/lib/scope-status";

const SECTION_ORDER = new Map<string, number>(SCOPE_SECTIONS.map((s, i) => [s, i]));

export type GroupableScopeLine = {
  category: string | null;
  status: string;
  quantity: number | null;
  unitPrice: number | null;
};

export type ScopeGroup<T> = {
  label: string;
  lines: T[];
  progress: ScopeProgress;
};

/**
 * Group scope lines by trade category in canonical section order, with
 * uncategorized lines last. Each group carries its own progress rollup so the
 * table can render "Flooring — 2 of 3 complete" on the band row.
 */
export function groupScopeByCategory<T extends GroupableScopeLine>(lines: T[]): ScopeGroup<T>[] {
  const byCategory = new Map<string, T[]>();
  for (const line of lines) {
    const key = line.category ?? "Uncategorized";
    (byCategory.get(key) ?? byCategory.set(key, []).get(key)!).push(line);
  }

  return [...byCategory.entries()]
    .sort(([a], [b]) => {
      // Unknown sections sink below the canonical list, then sort by name.
      const ai = SECTION_ORDER.get(a) ?? Number.MAX_SAFE_INTEGER;
      const bi = SECTION_ORDER.get(b) ?? Number.MAX_SAFE_INTEGER;
      return ai - bi || a.localeCompare(b);
    })
    .map(([label, groupLines]) => ({
      label,
      lines: groupLines,
      progress: rollUpScope(groupLines),
    }));
}

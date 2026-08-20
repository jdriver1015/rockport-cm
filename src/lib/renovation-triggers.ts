// ---------------------------------------------------------------------------
// Renovation type triggers: the pre-walk decision that picks between types, and
// the record of why one unit got the type it did.
//
// Shapes and the pure evaluation only — the queries live in
// renovation-triggers-store.ts. Kept apart because the editor and the answer
// panel are client components: importing anything that reaches `db` from here
// would drag the database client into the browser bundle.
// ---------------------------------------------------------------------------

export const TRIGGER_MODES = ["any", "all"] as const;
export type TriggerMode = (typeof TRIGGER_MODES)[number];

export const TRIGGER_MODE_LABELS: Record<TriggerMode, string> = {
  any: "If any checked",
  all: "If all checked",
};

export type TriggerCondition = { id: number; text: string; sortOrder: number };

export type TriggerStep = {
  id: number;
  mode: TriggerMode;
  sortOrder: number;
  budgetGroupId: number;
  /** Null when the renovation type has been archived out from under the rule. */
  typeName: string | null;
  conditions: TriggerCondition[];
};

export type TriggerAnswer = {
  conditionId: number | null;
  conditionText: string;
  checked: boolean;
  recordedAt: Date;
  recordedByName: string | null;
};

/**
 * Which step the given checked conditions select — the first whose condition is
 * met, mirroring how the rule reads on screen.
 *
 * Pure, so the same evaluation can be shown as a preview while editing the rule
 * and used when recording an answer. A step with no conditions never fires: an
 * empty "if any" would otherwise match everything and quietly capture every unit.
 */
export function evaluateTriggers(
  steps: TriggerStep[],
  checkedConditionIds: Set<number>,
): TriggerStep | null {
  for (const step of steps) {
    if (step.conditions.length === 0) continue;
    const hits = step.conditions.filter((c) => checkedConditionIds.has(c.id)).length;
    const fires = step.mode === "all" ? hits === step.conditions.length : hits > 0;
    if (fires) return step;
  }
  return null;
}

import { desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import type { ActivityLogRow } from "@/lib/actions/activity-log";
import { fetchBudgetLockEvents } from "@/lib/property-budget-lock";

// ---------------------------------------------------------------------------
// One row per changed field on a budget line — the same pattern
// src/lib/actions/activity-log.ts uses for a project, scoped to a property's
// budget instead. Plain (no "use server"): called from budget-lines.ts and
// property-budget-import.ts, both plain DB-layer files with no request
// context of their own — the same reason those files stay "use server"-free.
// ---------------------------------------------------------------------------

export type BudgetLineFieldChange = {
  /** Stable machine key, e.g. "uwAmount", "note", "archivedAt" */
  field: string;
  /** What's actually rendered — the line's name baked in, since this log spans every line on the property */
  fieldLabel: string;
  from: string | null;
  to: string | null;
  /**
   * Set explicitly whenever `from`/`to` are a lossy display string rather
   * than the exact underlying value — money() rounds to whole dollars, so
   * two different cent-level amounts can format identically and would
   * otherwise be dropped as a false no-op. When omitted, falls back to a
   * plain `from !== to` string comparison, which is exact for fields that
   * are already untransformed (note, "Active"/"Archived", etc).
   */
  changed?: boolean;
};

function toRows(
  budgetLineId: number,
  changes: BudgetLineFieldChange[],
  common: { propertyId: number; userId: string | null; note?: string | null },
) {
  return changes
    .filter((c) => c.changed ?? c.from !== c.to)
    .map((c) => ({
      propertyId: common.propertyId,
      budgetLineId,
      userId: common.userId,
      field: c.field,
      fieldLabel: c.fieldLabel,
      fromValue: c.from,
      toValue: c.to,
      note: common.note ?? null,
    }));
}

/** Insert one row per changed field. Call sites pre-format from/to (money(), etc). */
export async function logBudgetLineChanges(params: {
  propertyId: number;
  budgetLineId: number;
  userId: string | null;
  changes: BudgetLineFieldChange[];
  note?: string | null;
}) {
  const rows = toRows(params.budgetLineId, params.changes, params);
  if (rows.length === 0) return;
  await db().insert(schema.budgetLineActivityLog).values(rows);
}

/**
 * Same as logBudgetLineChanges, batched across multiple lines into a single
 * insert — for a workbook re-upload that can touch dozens of lines at once,
 * so the number of round trips doesn't grow with the number of changed
 * lines.
 */
export async function logBudgetLineChangesForLines(params: {
  propertyId: number;
  userId: string | null;
  note?: string | null;
  entries: { budgetLineId: number; changes: BudgetLineFieldChange[] }[];
}) {
  const rows = params.entries.flatMap((e) => toRows(e.budgetLineId, e.changes, params));
  if (rows.length === 0) return;
  await db().insert(schema.budgetLineActivityLog).values(rows);
}

/** Single-field convenience wrapper around logBudgetLineChanges. */
export async function logBudgetLineChange(params: {
  propertyId: number;
  budgetLineId: number;
  userId: string | null;
  field: string;
  fieldLabel: string;
  from: string | null;
  to: string | null;
  note?: string | null;
}) {
  await logBudgetLineChanges({
    propertyId: params.propertyId,
    budgetLineId: params.budgetLineId,
    userId: params.userId,
    note: params.note,
    changes: [{ field: params.field, fieldLabel: params.fieldLabel, from: params.from, to: params.to }],
  });
}

/** Null when the left join found no profile (userId was null, e.g. legacy/system rows). */
function displayName(fullName: string | null, email: string | null): string | null {
  if (email == null) return null;
  return fullName?.trim() || email;
}

/**
 * Everything that happened to a property's budget — line changes merged with
 * lock/unlock events, newest first. Mirrors fetchActivityLog's two-source
 * merge (there: the field log plus the legacy phase-only table; here: the
 * field log plus budgetLockEvents, which stays its own table rather than
 * being folded into this one).
 */
export async function fetchBudgetActivityLog(propertyId: number, limit = 200): Promise<ActivityLogRow[]> {
  const [lineRows, lockRows] = await Promise.all([
    db()
      .select({
        id: schema.budgetLineActivityLog.id,
        createdAt: schema.budgetLineActivityLog.createdAt,
        field: schema.budgetLineActivityLog.field,
        fieldLabel: schema.budgetLineActivityLog.fieldLabel,
        fromValue: schema.budgetLineActivityLog.fromValue,
        toValue: schema.budgetLineActivityLog.toValue,
        note: schema.budgetLineActivityLog.note,
        userFullName: schema.profiles.fullName,
        userEmail: schema.profiles.email,
      })
      .from(schema.budgetLineActivityLog)
      .leftJoin(schema.profiles, eq(schema.profiles.id, schema.budgetLineActivityLog.userId))
      .where(eq(schema.budgetLineActivityLog.propertyId, propertyId))
      .orderBy(desc(schema.budgetLineActivityLog.createdAt))
      .limit(limit),
    fetchBudgetLockEvents(propertyId, limit),
  ]);

  const merged: ActivityLogRow[] = [
    ...lineRows.map((r) => ({
      id: `line-${r.id}`,
      createdAt: r.createdAt,
      userName: displayName(r.userFullName, r.userEmail),
      field: r.field,
      fieldLabel: r.fieldLabel,
      fromValue: r.fromValue,
      toValue: r.toValue,
      note: r.note,
    })),
    ...lockRows.map((r) => ({
      id: `lock-${r.id}`,
      createdAt: r.createdAt,
      userName: r.userName,
      field: "lock",
      fieldLabel: "Budget lock",
      fromValue: null,
      toValue: r.action === "locked" ? "Locked" : "Unlocked",
      note: r.note,
    })),
  ];

  merged.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return merged.slice(0, limit);
}

/** Every non-archived line's id and its cost code's name, for building a
 *  human fieldLabel at write time ("Foundation — Budgeted amount"). */
export async function budgetLineNames(budgetLineIds: number[]): Promise<Map<number, string>> {
  if (budgetLineIds.length === 0) return new Map();
  const rows = await db()
    .select({ id: schema.budgetLines.id, name: schema.costCodes.name })
    .from(schema.budgetLines)
    .innerJoin(schema.costCodes, eq(schema.costCodes.id, schema.budgetLines.costCodeId))
    .where(inArray(schema.budgetLines.id, budgetLineIds));
  return new Map(rows.map((r) => [r.id, r.name]));
}

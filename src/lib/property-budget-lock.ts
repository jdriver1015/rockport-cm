import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { ActionResult } from "@/lib/action-result";

// ---------------------------------------------------------------------------
// Locking a property's non-interior budget — the flat budget_lines rows that
// export/import work with. Interior per-unit pricing is a separate system
// (renovation types, unit groups, trigger rules) with its own much larger
// mutation surface, and is not affected by this lock — the same boundary the
// export and import features already draw and explain to the user.
//
// properties.budgetLockedAt/By is the current state, cheap to check at every
// write site. budgetLockEvents is the full history behind it — every lock and
// unlock, who did it, when, and why — since "who locked this" is the whole
// point of the feature, not a side effect of it.
//
// Pure DB layer, no auth — kept separate from actions/budget-lock.ts (the
// "use server" wrapper) so a probe can exercise it directly, the same split
// property-budget-import.ts uses for the same reason.
// ---------------------------------------------------------------------------

export type BudgetLockState = {
  locked: boolean;
  lockedAt: Date | null;
  lockedByName: string | null;
};

export type BudgetLockEventRow = {
  id: number;
  action: "locked" | "unlocked";
  userName: string | null;
  note: string | null;
  createdAt: Date;
};

/** Null when the left join found no profile (userId was null). */
function displayName(fullName: string | null, email: string | null): string | null {
  if (email == null) return null;
  return fullName?.trim() || email;
}

export async function fetchBudgetLockState(propertyId: number): Promise<BudgetLockState> {
  const [row] = await db()
    .select({
      lockedAt: schema.properties.budgetLockedAt,
      lockedByFullName: schema.profiles.fullName,
      lockedByEmail: schema.profiles.email,
    })
    .from(schema.properties)
    .leftJoin(schema.profiles, eq(schema.profiles.id, schema.properties.budgetLockedBy))
    .where(eq(schema.properties.id, propertyId));

  if (!row) return { locked: false, lockedAt: null, lockedByName: null };
  return {
    locked: row.lockedAt !== null,
    lockedAt: row.lockedAt,
    lockedByName: displayName(row.lockedByFullName, row.lockedByEmail),
  };
}

export async function fetchBudgetLockEvents(propertyId: number, limit = 50): Promise<BudgetLockEventRow[]> {
  const rows = await db()
    .select({
      id: schema.budgetLockEvents.id,
      action: schema.budgetLockEvents.action,
      note: schema.budgetLockEvents.note,
      createdAt: schema.budgetLockEvents.createdAt,
      userFullName: schema.profiles.fullName,
      userEmail: schema.profiles.email,
    })
    .from(schema.budgetLockEvents)
    .leftJoin(schema.profiles, eq(schema.profiles.id, schema.budgetLockEvents.userId))
    .where(eq(schema.budgetLockEvents.propertyId, propertyId))
    .orderBy(desc(schema.budgetLockEvents.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    note: r.note,
    createdAt: r.createdAt,
    userName: displayName(r.userFullName, r.userEmail),
  }));
}

/**
 * Guard for every action that mutates a property's non-interior budget lines
 * — called from budget.ts's create/update/delete/restore and from
 * applyBudgetOverwrite, so a locked budget refuses every one of them the same
 * way regardless of which entry point was used.
 */
export async function assertBudgetUnlocked(propertyId: number): Promise<ActionResult> {
  const state = await fetchBudgetLockState(propertyId);
  if (state.locked) {
    return {
      ok: false,
      error: `Budget is locked${state.lockedByName ? ` by ${state.lockedByName}` : ""} — unlock it first`,
    };
  }
  return { ok: true };
}

/** The actual lock/unlock write: current-state columns plus its audit row, atomically. */
export async function applyBudgetLockChange(
  propertyId: number,
  action: "locked" | "unlocked",
  userId: string,
  note: string | null,
): Promise<void> {
  await db().transaction(async (tx) => {
    await tx
      .update(schema.properties)
      .set(
        action === "locked"
          ? { budgetLockedAt: new Date(), budgetLockedBy: userId }
          : { budgetLockedAt: null, budgetLockedBy: null },
      )
      .where(eq(schema.properties.id, propertyId));
    await tx.insert(schema.budgetLockEvents).values({ propertyId, action, userId, note });
  });
}

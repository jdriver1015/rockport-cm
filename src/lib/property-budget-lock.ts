import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import type { ActionResult } from "@/lib/action-result";

/** Either a transaction context or the bare db() handle — same shape applyBudgetImport uses. */
type DbOrTx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0] | ReturnType<typeof db>;

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
 *
 * This is a plain read, not tied to whatever mutation runs afterward — fine
 * for a quick "would this be refused" check, but a caller about to actually
 * write should use assertBudgetUnlockedForUpdate instead, inside the same
 * transaction as its write, so a lock can't land in the gap between the two.
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

/**
 * Same check as assertBudgetUnlocked, but takes a row lock on the property
 * for the rest of the caller's transaction. Every budget-line mutation opens
 * a transaction, calls this first, and does its write in the same
 * transaction — so a concurrent lockBudget either commits fully before this
 * check runs (and is correctly seen as locked) or blocks on the row lock
 * until this transaction commits (and only then takes effect). Without this,
 * the check and the write are two separate round trips with nothing between
 * them, and a lock can land in that gap unnoticed.
 */
export async function assertBudgetUnlockedForUpdate(tx: DbOrTx, propertyId: number): Promise<ActionResult> {
  const [row] = await tx
    .select({ lockedAt: schema.properties.budgetLockedAt, lockedBy: schema.properties.budgetLockedBy })
    .from(schema.properties)
    .where(eq(schema.properties.id, propertyId))
    .for("update");

  if (!row?.lockedAt) return { ok: true };

  const lockedByProfile = row.lockedBy
    ? await tx.query.profiles.findFirst({
        where: eq(schema.profiles.id, row.lockedBy),
        columns: { fullName: true, email: true },
      })
    : null;
  const lockedByName = lockedByProfile ? displayName(lockedByProfile.fullName, lockedByProfile.email) : null;
  return {
    ok: false,
    error: `Budget is locked${lockedByName ? ` by ${lockedByName}` : ""} — unlock it first`,
  };
}

/**
 * The actual lock/unlock write: current-state columns plus its audit row,
 * atomically — and, via the UPDATE's own WHERE clause, atomically checked
 * too. The WHERE clause doubles as a compare-and-swap: the UPDATE only
 * matches a row that's still in the expected state, so two concurrent lock
 * (or unlock) calls for the same property can't both succeed — Postgres
 * serializes them and re-evaluates the WHERE clause against whichever
 * committed first, so the second one simply matches no rows. Returns false
 * (writing nothing) when the property was already in the target state.
 */
export async function applyBudgetLockChange(
  propertyId: number,
  action: "locked" | "unlocked",
  userId: string,
  note: string | null,
): Promise<boolean> {
  return db().transaction(async (tx) => {
    const now = new Date();
    const [updated] = await tx
      .update(schema.properties)
      .set(
        action === "locked"
          ? { budgetLockedAt: now, budgetLockedBy: userId }
          : { budgetLockedAt: null, budgetLockedBy: null },
      )
      .where(
        and(
          eq(schema.properties.id, propertyId),
          action === "locked" ? isNull(schema.properties.budgetLockedAt) : isNotNull(schema.properties.budgetLockedAt),
        ),
      )
      .returning({ id: schema.properties.id });

    if (!updated) return false;

    // Stamped from the same `now` as the column above, not left to the
    // table's own defaultNow() — one clock for both halves of "who locked
    // this and when," rather than the app server's and Postgres's agreeing
    // only by coincidence.
    await tx.insert(schema.budgetLockEvents).values({ propertyId, action, userId, note, createdAt: now });
    return true;
  });
}

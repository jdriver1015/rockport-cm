/**
 * End-to-end probe of the non-interior budget lock, against the real database.
 *
 * lockBudget/unlockBudget (src/lib/actions/budget-lock.ts) require a real
 * Supabase session, which a script does not have. So — the same split
 * property-budget-import.ts uses for the same reason — the actual DB mutation
 * lives in property-budget-lock.ts's applyBudgetLockChange, callable directly
 * here. That leaves the "already locked" / "not locked" guards inside
 * lockBudget/unlockBudget themselves unexercised by this probe; they're a
 * single `if` each, read at the call site instead of run here.
 *
 * Every mutation below runs against a throwaway property this probe creates
 * and destroys itself. Aston is touched only by the two read-only fetches,
 * which cannot write anything regardless of what they return — the same
 * discipline probe-budget-import.ts adopted after the incident recorded in
 * its own header comment.
 *
 *   npx tsx scripts/probe-budget-lock.ts
 *
 * Exits non-zero if any assertion fails.
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { eq } from "drizzle-orm";
import { db, schema } from "../src/db";
import {
  fetchBudgetLockState,
  fetchBudgetLockEvents,
  assertBudgetUnlocked,
  applyBudgetLockChange,
} from "../src/lib/property-budget-lock";
import { createBudgetLine, updateBudgetLine, deleteBudgetLine, restoreBudgetLine } from "../src/lib/actions/budget";
import { loadFixtures } from "./probe-fixtures";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail?: string) {
  if (ok) {
    pass++;
    console.log(`  PASS  ${label}${detail ? `  — ${detail}` : ""}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}${detail ? `  — ${detail}` : ""}`);
  }
}

function fd(values: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.append(k, v);
  return f;
}

/**
 * budget.ts's actions call revalidatePath as their last step, which throws
 * outside a real Next.js request — there is no static-generation store in a
 * bare script. By the time that throws, the DB write it's reporting on has
 * already committed (revalidatePath is the last line before `return`), so
 * this treats that one specific invariant as a success rather than avoiding
 * the real action altogether.
 */
async function runAction<T extends { ok: boolean }>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof Error && err.message.includes("static generation store missing")) {
      return { ok: true } as T;
    }
    throw err;
  }
}

async function main() {
  const fx = await loadFixtures();
  const property = await db().query.properties.findFirst({ where: eq(schema.properties.id, fx.propertyId) });
  if (!property) throw new Error(`fixture property ${fx.propertyId} not found`);

  // ---- Aston: read-only. A guard against this probe ever accidentally
  // writing to the one real property, mirroring the outer check added after
  // the import-probe incident.
  const astonBefore = await db()
    .select({ uwAmount: schema.budgetLines.uwAmount })
    .from(schema.budgetLines)
    .where(eq(schema.budgetLines.propertyId, fx.propertyId));
  const astonSumBefore = astonBefore.reduce((s, r) => s + Number(r.uwAmount), 0);

  const astonLock = await fetchBudgetLockState(fx.propertyId);
  check("Aston: lock-state fetch returns a well-shaped result", typeof astonLock.locked === "boolean");
  const astonEvents = await fetchBudgetLockEvents(fx.propertyId);
  check("Aston: event fetch returns an array", Array.isArray(astonEvents));

  // ---- the write path: lock, gate every budget.ts mutation, unlock — on a
  // throwaway property this probe owns start to finish.
  let throwawayId = 0;
  let lineId = 0;
  try {
    const [throwaway] = await db()
      .insert(schema.properties)
      .values({
        name: "ZZ probe — budget lock",
        slug: `zz-probe-budget-lock-${Date.now()}`,
        chartOfAccountsId: property.chartOfAccountsId,
      })
      .returning({ id: schema.properties.id });
    throwawayId = throwaway.id;

    const initial = await fetchBudgetLockState(throwawayId);
    check("throwaway: starts unlocked", initial.locked === false && initial.lockedAt === null && initial.lockedByName === null);
    check("throwaway: starts with no lock history", (await fetchBudgetLockEvents(throwawayId)).length === 0);

    const guardWhenUnlocked = await assertBudgetUnlocked(throwawayId);
    check("assertBudgetUnlocked: ok while unlocked", guardWhenUnlocked.ok === true);

    const created = await runAction(() =>
      createBudgetLine(fd({ propertyId: String(throwawayId), costCodeId: String(fx.codeA), uwAmount: "10000" })),
    );
    check("createBudgetLine: succeeds while unlocked", created.ok === true);

    const line = await db().query.budgetLines.findFirst({
      where: eq(schema.budgetLines.propertyId, throwawayId),
    });
    lineId = line!.id;

    // A profile id to attribute the lock to — any real profile works; the
    // display-name join is exercised either way.
    const someProfile = await db().query.profiles.findFirst();
    if (!someProfile) throw new Error("no profiles in the database to attribute a lock to");

    await applyBudgetLockChange(throwawayId, "locked", someProfile.id, "probe: locking for a test");

    const lockedState = await fetchBudgetLockState(throwawayId);
    check(
      "throwaway: locked state reports lockedAt and the actor's display name",
      lockedState.locked === true && lockedState.lockedAt !== null && lockedState.lockedByName !== null,
      `lockedByName=${lockedState.lockedByName}`,
    );
    const eventsAfterLock = await fetchBudgetLockEvents(throwawayId);
    check(
      "throwaway: locking wrote one event carrying the note",
      eventsAfterLock.length === 1 && eventsAfterLock[0].action === "locked" && eventsAfterLock[0].note === "probe: locking for a test",
    );

    const guardWhenLocked = await assertBudgetUnlocked(throwawayId);
    check(
      "assertBudgetUnlocked: refused while locked, names the locker",
      guardWhenLocked.ok === false && guardWhenLocked.error.includes(lockedState.lockedByName ?? "\0"),
    );

    const createWhileLocked = await runAction(() =>
      createBudgetLine(fd({ propertyId: String(throwawayId), costCodeId: String(fx.codeB), uwAmount: "999" })),
    );
    check("createBudgetLine: refused while locked", createWhileLocked.ok === false);

    const updateWhileLocked = await runAction(() => updateBudgetLine({ id: lineId, propertyId: throwawayId, uwAmount: 55555 }));
    check("updateBudgetLine: refused while locked", updateWhileLocked.ok === false);

    const deleteWhileLocked = await runAction(() => deleteBudgetLine({ id: lineId, propertyId: throwawayId }));
    check("deleteBudgetLine: refused while locked", deleteWhileLocked.ok === false);

    const restoreWhileLocked = await runAction(() => restoreBudgetLine({ id: lineId, propertyId: throwawayId }));
    check("restoreBudgetLine: refused while locked", restoreWhileLocked.ok === false);

    const untouchedLine = await db().query.budgetLines.findFirst({ where: eq(schema.budgetLines.id, lineId) });
    check(
      "throwaway: the line itself never moved while every mutation was refused",
      Number(untouchedLine?.uwAmount) === 10000 && !untouchedLine?.archivedAt,
    );

    await applyBudgetLockChange(throwawayId, "unlocked", someProfile.id, null);

    const unlockedState = await fetchBudgetLockState(throwawayId);
    check("throwaway: unlocked state clears lockedAt and the actor", unlockedState.locked === false && unlockedState.lockedByName === null);
    const eventsAfterUnlock = await fetchBudgetLockEvents(throwawayId);
    check(
      "throwaway: unlocking appended a second event, oldest last",
      eventsAfterUnlock.length === 2 && eventsAfterUnlock[0].action === "unlocked" && eventsAfterUnlock[1].action === "locked",
    );

    const updateAfterUnlock = await runAction(() => updateBudgetLine({ id: lineId, propertyId: throwawayId, uwAmount: 12000 }));
    check("updateBudgetLine: succeeds again once unlocked", updateAfterUnlock.ok === true);
  } finally {
    if (throwawayId) {
      await db().delete(schema.budgetLockEvents).where(eq(schema.budgetLockEvents.propertyId, throwawayId));
      await db().delete(schema.budgetLines).where(eq(schema.budgetLines.propertyId, throwawayId));
      await db().delete(schema.properties).where(eq(schema.properties.id, throwawayId));
    }
    console.log("  teardown: throwaway property and its rows removed; Aston was never written to");
  }

  const astonAfter = await db()
    .select({ uwAmount: schema.budgetLines.uwAmount })
    .from(schema.budgetLines)
    .where(eq(schema.budgetLines.propertyId, fx.propertyId));
  const astonSumAfter = astonAfter.reduce((s, r) => s + Number(r.uwAmount), 0);
  check(
    "outer guard: Aston's budget_lines row count and sum are unchanged end to end",
    astonBefore.length === astonAfter.length && Math.abs(astonSumBefore - astonSumAfter) < 0.005,
    `${astonBefore.length}→${astonAfter.length} rows, ${astonSumBefore.toFixed(2)}→${astonSumAfter.toFixed(2)}`,
  );

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

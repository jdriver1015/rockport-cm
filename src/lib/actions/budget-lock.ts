"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { canWriteProperty } from "@/lib/auth-rules";
import { propertyPath } from "@/lib/property-path";
import { applyBudgetLockChange } from "@/lib/property-budget-lock";
import type { ActionResult } from "@/lib/action-result";

/**
 * Shared body for lockBudget/unlockBudget below — the only differences
 * between locking and unlocking are which permission-error string to use and
 * which action to pass through, both parameterized here rather than
 * duplicated across two near-identical functions.
 */
async function setBudgetLock(
  propertyId: number,
  action: "locked" | "unlocked",
  note: string | undefined,
): Promise<ActionResult> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  if (!canWriteProperty(auth.profile.role)) {
    return { ok: false, error: `You don't have permission to ${action === "locked" ? "lock" : "unlock"} this budget` };
  }

  const property = await db().query.properties.findFirst({
    where: eq(schema.properties.id, propertyId),
    columns: { id: true },
  });
  if (!property) return { ok: false, error: "Property not found" };

  // applyBudgetLockChange's own UPDATE is the check — its WHERE clause only
  // matches a property still in the opposite state, so this can't race a
  // concurrent lock/unlock call the way a separate read-then-write would.
  const changed = await applyBudgetLockChange(propertyId, action, auth.profile.id, note?.trim() || null);
  if (!changed) {
    return { ok: false, error: action === "locked" ? "Budget is already locked" : "Budget is not locked" };
  }

  const path = await propertyPath(propertyId, "/budget");
  if (path) revalidatePath(path);
  return { ok: true };
}

export async function lockBudget(propertyId: number, note?: string): Promise<ActionResult> {
  return setBudgetLock(propertyId, "locked", note);
}

export async function unlockBudget(propertyId: number, note?: string): Promise<ActionResult> {
  return setBudgetLock(propertyId, "unlocked", note);
}

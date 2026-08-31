"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { canWriteProperty } from "@/lib/auth-rules";
import { propertyPath } from "@/lib/property-path";
import { fetchBudgetLockState, applyBudgetLockChange } from "@/lib/property-budget-lock";
import type { ActionResult } from "@/lib/action-result";

export async function lockBudget(propertyId: number, note?: string): Promise<ActionResult> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  if (!canWriteProperty(auth.profile.role)) {
    return { ok: false, error: "You don't have permission to lock this budget" };
  }

  const property = await db().query.properties.findFirst({
    where: eq(schema.properties.id, propertyId),
    columns: { id: true },
  });
  if (!property) return { ok: false, error: "Property not found" };

  // fetchBudgetLockState, not a second relational-query read of budgetLockedAt
  // here: db()'s drizzle client is memoized on globalThis to survive dev-mode
  // hot reloads (see src/db/index.ts), which means its relational-query schema
  // snapshot can predate a column added after the server started, silently
  // reading it back as undefined. fetchBudgetLockState uses a plain select,
  // which always resolves columns off the live schema module instead.
  const state = await fetchBudgetLockState(propertyId);
  if (state.locked) return { ok: false, error: "Budget is already locked" };

  await applyBudgetLockChange(propertyId, "locked", auth.profile.id, note?.trim() || null);

  const path = await propertyPath(propertyId, "/budget");
  if (path) revalidatePath(path);
  return { ok: true };
}

export async function unlockBudget(propertyId: number, note?: string): Promise<ActionResult> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  if (!canWriteProperty(auth.profile.role)) {
    return { ok: false, error: "You don't have permission to unlock this budget" };
  }

  const property = await db().query.properties.findFirst({
    where: eq(schema.properties.id, propertyId),
    columns: { id: true },
  });
  if (!property) return { ok: false, error: "Property not found" };

  const state = await fetchBudgetLockState(propertyId);
  if (!state.locked) return { ok: false, error: "Budget is not locked" };

  await applyBudgetLockChange(propertyId, "unlocked", auth.profile.id, note?.trim() || null);

  const path = await propertyPath(propertyId, "/budget");
  if (path) revalidatePath(path);
  return { ok: true };
}

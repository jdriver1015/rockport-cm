import { revalidatePath } from "next/cache";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { assertBudgetUnlockedForUpdate } from "@/lib/property-budget-lock";
import { propertyPath } from "@/lib/property-path";
import { logBudgetLineChanges, type BudgetLineFieldChange } from "@/lib/budget-activity-log";
import { money } from "@/lib/format";
import type { ActionResult } from "@/lib/action-result";

// ---------------------------------------------------------------------------
// Pure DB layer behind actions/budget.ts's "use server" wrappers (auth +
// FormData parsing) — kept separate so a probe can exercise these without a
// live Supabase session, the same split property-budget-import.ts and
// property-budget-lock.ts use for the same reason.
//
// Each function checks the lock and writes inside one transaction, via
// assertBudgetUnlockedForUpdate's row lock on the property — not a plain read
// followed by a separate write, which would leave a gap for a concurrent
// lockBudget to land in unnoticed.
// ---------------------------------------------------------------------------

export async function createBudgetLineCore(input: {
  propertyId: number;
  costCodeId: number;
  uwAmount?: number;
  perUnitAmount?: number;
  plannedUnits?: number;
  note?: string;
  userId: string | null;
}): Promise<ActionResult> {
  const { propertyId, costCodeId, perUnitAmount, plannedUnits, note, userId } = input;

  const costCode = await db().query.costCodes.findFirst({
    where: eq(schema.costCodes.id, costCodeId),
  });
  if (!costCode) return { ok: false, error: "Cost code not found" };

  // The code must belong to this property's chart of accounts.
  const property = await db().query.properties.findFirst({
    where: eq(schema.properties.id, propertyId),
    columns: { chartOfAccountsId: true },
  });
  if (!property) return { ok: false, error: "Property not found" };
  if (costCode.chartId !== property.chartOfAccountsId) {
    return { ok: false, error: "That cost code isn't in this property's chart of accounts" };
  }

  const uwAmount =
    perUnitAmount !== undefined && plannedUnits !== undefined
      ? perUnitAmount * plannedUnits
      : (input.uwAmount ?? 0);
  if (uwAmount <= 0) {
    return { ok: false, error: "Enter a budgeted amount" };
  }

  const result = await db().transaction(async (tx): Promise<ActionResult<{ id: number }>> => {
    const lockCheck = await assertBudgetUnlockedForUpdate(tx, propertyId);
    if (!lockCheck.ok) return lockCheck;

    const existing = await tx.query.budgetLines.findFirst({
      where: and(
        eq(schema.budgetLines.propertyId, propertyId),
        eq(schema.budgetLines.costCodeId, costCodeId),
        isNull(schema.budgetLines.archivedAt),
      ),
    });
    if (existing) {
      return { ok: false, error: `${costCode.name} already has a budget line for this property` };
    }

    const [inserted] = await tx
      .insert(schema.budgetLines)
      .values({
        propertyId,
        costCodeId,
        uwAmount: uwAmount.toFixed(2),
        perUnitAmount: perUnitAmount !== undefined ? perUnitAmount.toFixed(2) : undefined,
        plannedUnits,
        note,
      })
      .returning({ id: schema.budgetLines.id });
    return { ok: true, id: inserted.id };
  });

  if (result.ok) {
    const path = await propertyPath(propertyId, "/budget");
    if (path) revalidatePath(path);
    revalidatePath("/");
    await logBudgetLineChanges({
      propertyId,
      budgetLineId: result.id,
      userId,
      note: "Line created",
      changes: [
        {
          field: "uwAmount",
          fieldLabel: `${costCode.name} — Budgeted amount`,
          from: null,
          to: money(uwAmount),
        },
      ],
    });
  }
  return result;
}

export async function updateBudgetLineCore(input: {
  id: number;
  propertyId: number;
  uwAmount?: number;
  perUnitAmount?: number;
  plannedUnits?: number;
  note?: string;
  userId: string | null;
}): Promise<ActionResult> {
  const { id, propertyId, perUnitAmount, plannedUnits, note, userId } = input;

  // Interior lines budget per unit; others take a direct amount.
  const uwAmount =
    perUnitAmount !== undefined && plannedUnits !== undefined
      ? perUnitAmount * plannedUnits
      : (input.uwAmount ?? 0);
  if (uwAmount <= 0) {
    return { ok: false, error: "Enter a budgeted amount" };
  }

  const result = await db().transaction(async (tx): Promise<ActionResult<{ changes: BudgetLineFieldChange[] }>> => {
    const lockCheck = await assertBudgetUnlockedForUpdate(tx, propertyId);
    if (!lockCheck.ok) return lockCheck;

    // Read the "before" state inside the transaction, after the property's
    // row lock is held — not beforehand. A plain pre-fetch outside the lock
    // could read a value that a concurrent update (blocked on the same lock)
    // is about to overwrite, then log this edit's "from" as whatever it saw
    // before that other write ever committed: a false entry in the audit
    // trail, and not merely a display glitch, since it's the log's job to
    // say what actually changed.
    const [line] = await tx
      .select({
        propertyId: schema.budgetLines.propertyId,
        uwAmount: schema.budgetLines.uwAmount,
        perUnitAmount: schema.budgetLines.perUnitAmount,
        plannedUnits: schema.budgetLines.plannedUnits,
        note: schema.budgetLines.note,
        costCodeName: schema.costCodes.name,
      })
      .from(schema.budgetLines)
      .innerJoin(schema.costCodes, eq(schema.costCodes.id, schema.budgetLines.costCodeId))
      .where(eq(schema.budgetLines.id, id));
    if (!line || line.propertyId !== propertyId) {
      return { ok: false, error: "Budget line not found" };
    }

    await tx
      .update(schema.budgetLines)
      .set({
        uwAmount: uwAmount.toFixed(2),
        perUnitAmount: perUnitAmount !== undefined ? perUnitAmount.toFixed(2) : null,
        plannedUnits: plannedUnits ?? null,
        note: note ?? null,
        updatedAt: new Date(),
      })
      .where(eq(schema.budgetLines.id, id));

    const newPerUnitAmount = perUnitAmount !== undefined ? perUnitAmount.toFixed(2) : null;
    // Every potential change is passed through — logBudgetLineChanges drops
    // whichever ones didn't actually move, so a non-interior line's untouched
    // perUnitAmount/plannedUnits (always null on both sides) never logs
    // noise. `changed` compares the exact fixed-point strings, not the
    // money()-formatted display text below: money() rounds to whole
    // dollars, so a real cent-level edit (both amount inputs allow $0.01
    // steps) can format identically on both sides and would otherwise be
    // silently dropped as a false no-op.
    const changes: BudgetLineFieldChange[] = [
      {
        field: "uwAmount",
        fieldLabel: `${line.costCodeName} — Budgeted amount`,
        from: money(Number(line.uwAmount)),
        to: money(uwAmount),
        changed: line.uwAmount !== uwAmount.toFixed(2),
      },
      {
        field: "perUnitAmount",
        fieldLabel: `${line.costCodeName} — Per unit amount`,
        from: line.perUnitAmount !== null ? money(Number(line.perUnitAmount)) : null,
        to: newPerUnitAmount !== null ? money(perUnitAmount!) : null,
        changed: line.perUnitAmount !== newPerUnitAmount,
      },
      {
        field: "plannedUnits",
        fieldLabel: `${line.costCodeName} — Planned units`,
        from: line.plannedUnits !== null ? String(line.plannedUnits) : null,
        to: plannedUnits !== undefined ? String(plannedUnits) : null,
      },
      {
        field: "note",
        fieldLabel: `${line.costCodeName} — Note`,
        from: line.note,
        to: note ?? null,
      },
    ];
    return { ok: true, changes };
  });

  if (result.ok) {
    const path = await propertyPath(propertyId, "/budget");
    if (path) revalidatePath(path);
    revalidatePath("/");
    await logBudgetLineChanges({ propertyId, budgetLineId: id, userId, changes: result.changes });
  }
  return result;
}

export async function deleteBudgetLineCore(input: {
  id: number;
  propertyId: number;
  userId: string | null;
}): Promise<ActionResult> {
  const [line] = await db()
    .select({ propertyId: schema.budgetLines.propertyId, costCodeName: schema.costCodes.name })
    .from(schema.budgetLines)
    .innerJoin(schema.costCodes, eq(schema.costCodes.id, schema.budgetLines.costCodeId))
    .where(eq(schema.budgetLines.id, input.id));
  if (!line || line.propertyId !== input.propertyId) {
    return { ok: false, error: "Budget line not found" };
  }

  const result = await db().transaction(async (tx): Promise<ActionResult<{ archived: boolean }>> => {
    const lockCheck = await assertBudgetUnlockedForUpdate(tx, input.propertyId);
    if (!lockCheck.ok) return lockCheck;

    // Guarded on the current state, not a blind write: a second delete for
    // the same line (a double-click before the button disables, or the
    // Undo toast's own button, which has no busy guard) then updates zero
    // rows instead of quietly re-archiving something already archived — and
    // the log below only fires for a transition that actually happened.
    const [archived] = await tx
      .update(schema.budgetLines)
      .set({ archivedAt: new Date() })
      .where(and(eq(schema.budgetLines.id, input.id), isNull(schema.budgetLines.archivedAt)))
      .returning({ id: schema.budgetLines.id });
    return { ok: true, archived: !!archived };
  });

  if (result.ok) {
    const path = await propertyPath(input.propertyId, "/budget");
    if (path) revalidatePath(path);
    revalidatePath("/");
    if (result.archived) {
      await logBudgetLineChanges({
        propertyId: input.propertyId,
        budgetLineId: input.id,
        userId: input.userId,
        changes: [
          {
            field: "archivedAt",
            fieldLabel: line.costCodeName,
            from: "Active",
            to: "Archived",
          },
        ],
      });
    }
  }
  return result;
}

/** Reverses deleteBudgetLineCore — used by the delete toast's Undo action. */
export async function restoreBudgetLineCore(input: {
  id: number;
  propertyId: number;
  userId: string | null;
}): Promise<ActionResult> {
  const [line] = await db()
    .select({ propertyId: schema.budgetLines.propertyId, costCodeName: schema.costCodes.name })
    .from(schema.budgetLines)
    .innerJoin(schema.costCodes, eq(schema.costCodes.id, schema.budgetLines.costCodeId))
    .where(eq(schema.budgetLines.id, input.id));
  if (!line || line.propertyId !== input.propertyId) {
    return { ok: false, error: "Budget line not found" };
  }

  const result = await db().transaction(async (tx): Promise<ActionResult<{ restored: boolean }>> => {
    const lockCheck = await assertBudgetUnlockedForUpdate(tx, input.propertyId);
    if (!lockCheck.ok) return lockCheck;

    // Mirrors deleteBudgetLineCore's guard — see its comment.
    const [restored] = await tx
      .update(schema.budgetLines)
      .set({ archivedAt: null })
      .where(and(eq(schema.budgetLines.id, input.id), isNotNull(schema.budgetLines.archivedAt)))
      .returning({ id: schema.budgetLines.id });
    return { ok: true, restored: !!restored };
  });

  if (result.ok) {
    const path = await propertyPath(input.propertyId, "/budget");
    if (path) revalidatePath(path);
    revalidatePath("/");
    if (result.restored) {
      await logBudgetLineChanges({
        propertyId: input.propertyId,
        budgetLineId: input.id,
        userId: input.userId,
        changes: [
          {
            field: "archivedAt",
            fieldLabel: line.costCodeName,
            from: "Archived",
            to: "Active",
          },
        ],
      });
    }
  }
  return result;
}

import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { scopeLineTotal } from "@/lib/scope-total";

// ---------------------------------------------------------------------------
// A project's budget is what its scope adds up to.
//
// projects.budget_amount used to be typed — in an inline editor, in the Confirm
// Scope dialog, in Manage > Edit — while the scope lines carried their own
// quantity x unit price, and nothing kept the two in step. define-scope-dialog
// said so out loud: "worth saying out loud when they disagree: one of the two is
// wrong, and which one is a judgement only the person can make." The app had
// invented a reconciliation problem for itself, and every unit turn in the
// portfolio carried the same stale $12,906 tier default against real scope sums
// between $11,247 and $16,992.
//
// So there is one number now, and it is derived. The approved budget that
// matters is the underwriting allowance per category — budget_lines.uw_amount,
// or a tier's per-unit line — which the scope table already compares each line
// against.
// ---------------------------------------------------------------------------

/**
 * Recompute projects.budget_amount from the project's priced scope lines.
 *
 * Unpriced lines contribute nothing, which is why the UI says "not priced yet"
 * rather than $0 — a project nobody has priced has no budget, and reporting
 * zero would be a claim rather than an absence.
 */
export async function recomputeProjectBudget(projectId: number): Promise<number> {
  const lines = await db()
    .select({
      quantity: schema.scopeItems.quantity,
      unitPrice: schema.scopeItems.unitPrice,
    })
    .from(schema.scopeItems)
    .where(and(eq(schema.scopeItems.projectId, projectId), isNull(schema.scopeItems.archivedAt)));

  const total = lines.reduce((sum, l) => sum + (scopeLineTotal(l) ?? 0), 0);

  await db()
    .update(schema.projects)
    .set({ budgetAmount: total.toFixed(2) })
    .where(eq(schema.projects.id, projectId));

  return total;
}

/** How many of a project's live scope lines still have no price. */
export async function unpricedLineCount(projectId: number): Promise<number> {
  const lines = await db()
    .select({
      quantity: schema.scopeItems.quantity,
      unitPrice: schema.scopeItems.unitPrice,
    })
    .from(schema.scopeItems)
    .where(and(eq(schema.scopeItems.projectId, projectId), isNull(schema.scopeItems.archivedAt)));

  return lines.filter((l) => scopeLineTotal(l) == null).length;
}

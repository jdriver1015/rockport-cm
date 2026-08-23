import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";

// ---------------------------------------------------------------------------
// The approved budget, and the code it books to.
//
// Its own module because three places set it now — the edit dialog, the confirm
// gate, and the cost bar — and a rule enforced in one of them is not enforced.
//
// Plain functions, not the actions: revalidatePath throws outside a request.
// ---------------------------------------------------------------------------

export type BudgetResult = { ok: true } | { ok: false; error: string };

export async function setProjectBudgetRow(
  projectId: number,
  budgetAmount: number | null,
  costCodeId: number | null | undefined,
): Promise<BudgetResult> {
  if (budgetAmount != null && (!Number.isFinite(budgetAmount) || budgetAmount < 0)) {
    return { ok: false, error: "Enter a valid budget" };
  }

  const project = await db().query.projects.findFirst({
    where: eq(schema.projects.id, projectId),
    columns: { id: true, kind: true, propertyId: true },
  });
  if (!project) return { ok: false, error: "Project not found" };

  // An interior turn spends across every 4000-series code, so a single UW line
  // item would be a lie. Its budget comes from the renovation template.
  const codeApplies = project.kind === "common" && costCodeId !== undefined;

  if (codeApplies && costCodeId != null) {
    const [code, property] = await Promise.all([
      db().query.costCodes.findFirst({
        where: eq(schema.costCodes.id, costCodeId),
        columns: { chartId: true },
      }),
      db().query.properties.findFirst({
        where: eq(schema.properties.id, project.propertyId),
        columns: { chartOfAccountsId: true },
      }),
    ]);
    if (!code) return { ok: false, error: "Cost code not found" };
    if (!property) return { ok: false, error: "Property not found" };
    if (code.chartId !== property.chartOfAccountsId) {
      return { ok: false, error: "That cost code isn't in this property's chart of accounts" };
    }
  }

  await db()
    .update(schema.projects)
    .set({
      // budget_amount is NOT NULL DEFAULT '0', so "unset" is zero — the state
      // the cost bar already draws as "no budget approved".
      ...(budgetAmount == null ? {} : { budgetAmount: budgetAmount.toFixed(2) }),
      ...(codeApplies ? { costCodeId: costCodeId ?? null } : {}),
    })
    .where(eq(schema.projects.id, projectId));

  return { ok: true };
}

/** What the confirm gate and the cost bar both need to show. */
export async function readProjectBudget(projectId: number) {
  const row = await db().query.projects.findFirst({
    where: eq(schema.projects.id, projectId),
    columns: { budgetAmount: true, costCodeId: true, kind: true },
  });
  if (!row) return null;
  return {
    budgetAmount: Number(row.budgetAmount ?? 0),
    costCodeId: row.costCodeId,
    kind: row.kind,
  };
}

/** Active codes this project could book to. Empty for an interior turn. */
export async function readBudgetCostCodes(propertyId: number, kind: string) {
  return db()
    .select({ id: schema.costCodes.id, code: schema.costCodes.code, name: schema.costCodes.name })
    .from(schema.costCodes)
    .innerJoin(schema.properties, eq(schema.properties.chartOfAccountsId, schema.costCodes.chartId))
    .where(
      and(
        eq(schema.properties.id, propertyId),
        eq(schema.costCodes.active, true),
        eq(schema.costCodes.isInterior, kind === "unit"),
      ),
    );
}

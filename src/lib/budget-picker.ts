import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";

/**
 * The UW lines this property carries, with what is already spoken for.
 *
 * Allocated counts every scope line on the property against that code, which is
 * the same figure the scope dialog compares a line against — so the wizard and
 * the project page cannot disagree about what is left.
 */
export async function readBudgetLinesForPicker(propertyId: number) {
  const [lines, scope] = await Promise.all([
    db()
      .select({
        costCodeId: schema.budgetLines.costCodeId,
        uwAmount: schema.budgetLines.uwAmount,
        code: schema.costCodes.code,
        name: schema.costCodes.name,
      })
      .from(schema.budgetLines)
      .innerJoin(schema.costCodes, eq(schema.costCodes.id, schema.budgetLines.costCodeId))
      .where(
        and(eq(schema.budgetLines.propertyId, propertyId), isNull(schema.budgetLines.archivedAt)),
      ),
    db()
      .select({
        costCodeId: schema.scopeItems.costCodeId,
        quantity: schema.scopeItems.quantity,
        unitPrice: schema.scopeItems.unitPrice,
      })
      .from(schema.scopeItems)
      .innerJoin(schema.projects, eq(schema.scopeItems.projectId, schema.projects.id))
      .where(
        and(
          eq(schema.projects.propertyId, propertyId),
          isNull(schema.scopeItems.archivedAt),
          isNull(schema.projects.archivedAt),
        ),
      ),
  ]);

  const allocated = new Map<number, number>();
  for (const s of scope) {
    if (s.costCodeId == null) continue;
    allocated.set(
      s.costCodeId,
      (allocated.get(s.costCodeId) ?? 0) + Number(s.quantity ?? 0) * Number(s.unitPrice ?? 0),
    );
  }

  return lines.map((l) => ({
    costCodeId: l.costCodeId,
    code: l.code,
    name: l.name,
    approved: Number(l.uwAmount),
    allocated: allocated.get(l.costCodeId) ?? 0,
  }));
}

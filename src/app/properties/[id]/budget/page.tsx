import { notFound } from "next/navigation";
import { asc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { Card, CardContent } from "@/components/ui/card";
import { PropertyNav } from "@/components/property-nav";
import { BudgetView, type BudgetCategory } from "@/components/budget-view";
import { num } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function BudgetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const propertyId = Number(id);
  if (!Number.isInteger(propertyId)) notFound();

  const property = await db().query.properties.findFirst({
    where: eq(schema.properties.id, propertyId),
  });
  if (!property) notFound();

  const categories = await db()
    .select()
    .from(schema.costCategories)
    .orderBy(asc(schema.costCategories.sortOrder));

  const codes = await db()
    .select()
    .from(schema.costCodes)
    .where(eq(schema.costCodes.active, true))
    .orderBy(asc(schema.costCodes.code));

  const lines = await db()
    .select()
    .from(schema.budgetLines)
    .where(eq(schema.budgetLines.propertyId, propertyId));

  // JTD committed per cost code — contracted amounts on projects coded to the line.
  const committedRows = await db()
    .select({
      costCodeId: schema.projects.costCodeId,
      total: sql<string>`coalesce(sum(${schema.projects.committedCost}), 0)`,
    })
    .from(schema.projects)
    .where(
      sql`${schema.projects.propertyId} = ${propertyId} and ${schema.projects.costCodeId} is not null`,
    )
    .groupBy(schema.projects.costCodeId);
  const committedByCode = new Map(committedRows.map((r) => [r.costCodeId, num(r.total)]));

  // JTD completed per cost code — posted GL actuals.
  const completedRows = await db()
    .select({
      costCodeId: schema.glTransactions.costCodeId,
      total: sql<string>`coalesce(sum(${schema.glTransactions.amount}), 0)`,
    })
    .from(schema.glTransactions)
    .where(
      sql`${schema.glTransactions.propertyId} = ${propertyId} and ${schema.glTransactions.status} = 'posted' and ${schema.glTransactions.costCodeId} is not null`,
    )
    .groupBy(schema.glTransactions.costCodeId);
  const completedByCode = new Map(completedRows.map((r) => [r.costCodeId, num(r.total)]));

  const lineByCode = new Map(lines.map((l) => [l.costCodeId, l]));

  // Build the category → lines tree the view renders. Only categories with at
  // least one budgeted line appear (matches the prior page behavior).
  const budgetCategories: BudgetCategory[] = categories
    .map((cat) => {
      const catCodes = codes.filter((c) => c.categoryId === cat.id);
      const catLines = catCodes
        .map((c) => ({ code: c, line: lineByCode.get(c.id) }))
        .filter((x) => x.line);
      if (catLines.length === 0) return null;

      const lineRows = catLines.map(({ code, line }) => ({
        code: code.code,
        name: code.name,
        budget: num(line!.uwAmount),
        committed: committedByCode.get(code.id) ?? 0,
        completed: completedByCode.get(code.id) ?? 0,
      }));

      return {
        code: cat.code,
        name: cat.name,
        budget: lineRows.reduce((s, l) => s + l.budget, 0),
        committed: lineRows.reduce((s, l) => s + l.committed, 0),
        completed: lineRows.reduce((s, l) => s + l.completed, 0),
        lines: lineRows,
      } satisfies BudgetCategory;
    })
    .filter((c): c is BudgetCategory => c !== null);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-semibold text-navy">{property.name}</h1>
      </div>

      <PropertyNav propertyId={property.id} />

      <Card>
        <CardContent className="pt-6">
          <BudgetView categories={budgetCategories} />
        </CardContent>
      </Card>
    </div>
  );
}

import { notFound } from "next/navigation";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PropertyHeader } from "@/components/property-header";
import { PropertyNav } from "@/components/property-nav";
import { BudgetView, type BudgetCategory } from "@/components/budget-view";
import { AddBudgetLineDialog } from "@/components/add-budget-line-dialog";
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

  // These queries don't depend on each other, so fire them in parallel — one
  // network round-trip instead of seven against the pooled Supabase connection.
  const [categories, codes, lines, committedRows, completedRows, projectRows, jtdRows] =
    await Promise.all([
      db().select().from(schema.costCategories).orderBy(asc(schema.costCategories.sortOrder)),
      db()
        .select()
        .from(schema.costCodes)
        .where(eq(schema.costCodes.active, true))
        .orderBy(asc(schema.costCodes.code)),
      db()
        .select()
        .from(schema.budgetLines)
        .where(
          and(eq(schema.budgetLines.propertyId, propertyId), isNull(schema.budgetLines.archivedAt)),
        ),
      // JTD committed per cost code — contracted amounts on projects coded to the line.
      db()
        .select({
          costCodeId: schema.projects.costCodeId,
          total: sql<string>`coalesce(sum(${schema.projects.committedCost}), 0)`,
        })
        .from(schema.projects)
        .where(
          sql`${schema.projects.propertyId} = ${propertyId} and ${schema.projects.costCodeId} is not null`,
        )
        .groupBy(schema.projects.costCodeId),
      // JTD completed per cost code — posted GL actuals.
      db()
        .select({
          costCodeId: schema.glTransactions.costCodeId,
          total: sql<string>`coalesce(sum(${schema.glTransactions.amount}), 0)`,
        })
        .from(schema.glTransactions)
        .where(
          sql`${schema.glTransactions.propertyId} = ${propertyId} and ${schema.glTransactions.status} = 'posted' and ${schema.glTransactions.costCodeId} is not null`,
        )
        .groupBy(schema.glTransactions.costCodeId),
      // Projects coded to each line (common projects link to a cost code; interior
      // unit projects have no single cost code, so those lines show none).
      db()
        .select({
          id: schema.projects.id,
          name: schema.projects.name,
          stage: schema.projects.stage,
          costCodeId: schema.projects.costCodeId,
          budgetAmount: schema.projects.budgetAmount,
          committedCost: schema.projects.committedCost,
        })
        .from(schema.projects)
        .where(eq(schema.projects.propertyId, propertyId))
        .orderBy(asc(schema.projects.name)),
      db()
        .select({
          projectId: schema.glTransactions.projectId,
          total: sql<string>`coalesce(sum(${schema.glTransactions.amount}), 0)`,
        })
        .from(schema.glTransactions)
        .where(
          sql`${schema.glTransactions.propertyId} = ${propertyId} and ${schema.glTransactions.status} = 'posted' and ${schema.glTransactions.projectId} is not null`,
        )
        .groupBy(schema.glTransactions.projectId),
    ]);

  const committedByCode = new Map(committedRows.map((r) => [r.costCodeId, num(r.total)]));
  const completedByCode = new Map(completedRows.map((r) => [r.costCodeId, num(r.total)]));
  const jtdByProject = new Map(jtdRows.map((r) => [r.projectId, num(r.total)]));

  const projectsByCode = new Map<number, BudgetCategory["lines"][number]["projects"]>();
  for (const p of projectRows) {
    if (p.costCodeId == null) continue;
    const list = projectsByCode.get(p.costCodeId) ?? [];
    list.push({
      id: p.id,
      name: p.name,
      stage: p.stage,
      budget: num(p.budgetAmount),
      committed: num(p.committedCost),
      completed: jtdByProject.get(p.id) ?? 0,
    });
    projectsByCode.set(p.costCodeId, list);
  }

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
        id: line!.id,
        costCodeId: code.id,
        code: code.code,
        name: code.name,
        budget: num(line!.uwAmount),
        committed: committedByCode.get(code.id) ?? 0,
        completed: completedByCode.get(code.id) ?? 0,
        perUnitAmount: line!.perUnitAmount ? num(line!.perUnitAmount) : null,
        plannedUnits: line!.plannedUnits ?? null,
        isInterior: code.isInterior,
        note: line!.note,
        projects: projectsByCode.get(code.id) ?? [],
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

  const categoryOptions = categories.map((c) => ({ id: c.id, code: c.code, name: c.name }));
  const costCodeOptions = codes.map((c) => ({
    id: c.id,
    categoryId: c.categoryId,
    code: c.code,
    name: c.name,
    isInterior: c.isInterior,
  }));
  const budgetedCostCodeIds = lines.map((l) => l.costCodeId);

  return (
    <div className="space-y-6">
      <PropertyHeader property={property} />

      <PropertyNav propertyId={property.id} />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base text-navy">Budget</CardTitle>
          <AddBudgetLineDialog
            propertyId={property.id}
            categories={categoryOptions}
            costCodes={costCodeOptions}
            budgetedCostCodeIds={budgetedCostCodeIds}
          />
        </CardHeader>
        <CardContent>
          <BudgetView propertyId={property.id} categories={budgetCategories} />
        </CardContent>
      </Card>
    </div>
  );
}

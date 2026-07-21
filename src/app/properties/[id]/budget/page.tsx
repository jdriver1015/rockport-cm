import { notFound } from "next/navigation";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PropertyHeader } from "@/components/property-header";
import { PropertyNav } from "@/components/property-nav";
import { BudgetView, type BudgetCategory, type BudgetDivision } from "@/components/budget-view";
import { AddBudgetLineDialog } from "@/components/add-budget-line-dialog";
import { PropertyChartControl } from "@/components/property-chart-control";
import { num } from "@/lib/format";
import { DIVISIONS, divisionLabel } from "@/lib/divisions";
import { bucketForStage } from "@/lib/stage-buckets";

export const dynamic = "force-dynamic";

export default async function BudgetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const propertyId = Number(id);
  if (!Number.isInteger(propertyId)) notFound();

  const property = await db().query.properties.findFirst({
    where: eq(schema.properties.id, propertyId),
  });
  if (!property) notFound();

  // Chart-of-accounts context for the switch control in the header.
  const [chart, allCharts, [{ glCount }], [{ codedProjects }]] = await Promise.all([
    db().query.chartsOfAccounts.findFirst({
      where: eq(schema.chartsOfAccounts.id, property.chartOfAccountsId),
    }),
    db()
      .select({
        id: schema.chartsOfAccounts.id,
        name: schema.chartsOfAccounts.name,
        isDefault: schema.chartsOfAccounts.isDefault,
      })
      .from(schema.chartsOfAccounts)
      .where(isNull(schema.chartsOfAccounts.archivedAt))
      .orderBy(asc(schema.chartsOfAccounts.name)),
    db()
      .select({ glCount: sql<number>`count(*)::int` })
      .from(schema.glTransactions)
      .where(eq(schema.glTransactions.propertyId, propertyId)),
    db()
      .select({ codedProjects: sql<number>`count(*)::int` })
      .from(schema.projects)
      .where(and(eq(schema.projects.propertyId, propertyId), sql`${schema.projects.costCodeId} is not null`)),
  ]);

  // These queries don't depend on each other, so fire them in parallel — one
  // network round-trip instead of seven against the pooled Supabase connection.
  const [categories, codes, lines, orphanGlRows, projectRows, jtdRows] =
    await Promise.all([
      db()
        .select()
        .from(schema.costCategories)
        .where(eq(schema.costCategories.chartId, property.chartOfAccountsId))
        .orderBy(asc(schema.costCategories.sortOrder)),
      db()
        .select()
        .from(schema.costCodes)
        .where(and(eq(schema.costCodes.chartId, property.chartOfAccountsId), eq(schema.costCodes.active, true)))
        .orderBy(asc(schema.costCodes.code)),
      db()
        .select()
        .from(schema.budgetLines)
        .where(
          and(eq(schema.budgetLines.propertyId, propertyId), isNull(schema.budgetLines.archivedAt)),
        ),
      // Posted GL with no owning project — real spend with no stage to bucket
      // by, so it always counts as Completed.
      db()
        .select({
          costCodeId: schema.glTransactions.costCodeId,
          total: sql<string>`coalesce(sum(${schema.glTransactions.amount}), 0)`,
        })
        .from(schema.glTransactions)
        .where(
          sql`${schema.glTransactions.propertyId} = ${propertyId} and ${schema.glTransactions.status} = 'posted' and ${schema.glTransactions.costCodeId} is not null and ${schema.glTransactions.projectId} is null`,
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

  const jtdByProject = new Map(jtdRows.map((r) => [r.projectId, num(r.total)]));

  // Bucket each cost code's dollars into Planned / In Process / Completed —
  // a project's committed cost or actual spend lands in exactly one bucket,
  // chosen by its own current stage (see src/lib/stage-buckets.ts).
  type CodeBuckets = { planned: number; inProcess: number; completed: number };
  const bucketsByCode = new Map<number, CodeBuckets>();
  function addToBucket(codeId: number, key: keyof CodeBuckets, amount: number) {
    const b = bucketsByCode.get(codeId) ?? { planned: 0, inProcess: 0, completed: 0 };
    b[key] += amount;
    bucketsByCode.set(codeId, b);
  }

  const projectsByCode = new Map<number, BudgetCategory["lines"][number]["projects"]>();
  for (const p of projectRows) {
    if (p.costCodeId == null) continue;
    const completedAmount = jtdByProject.get(p.id) ?? 0;
    const committedAmount = num(p.committedCost);
    const list = projectsByCode.get(p.costCodeId) ?? [];
    list.push({
      id: p.id,
      name: p.name,
      stage: p.stage,
      budget: num(p.budgetAmount),
      committed: committedAmount,
      completed: completedAmount,
    });
    projectsByCode.set(p.costCodeId, list);

    const bucket = bucketForStage(p.stage);
    if (bucket === "planned") addToBucket(p.costCodeId, "planned", committedAmount);
    else if (bucket === "in_process") addToBucket(p.costCodeId, "inProcess", committedAmount);
    else addToBucket(p.costCodeId, "completed", completedAmount);
  }
  for (const r of orphanGlRows) {
    if (r.costCodeId == null) continue;
    addToBucket(r.costCodeId, "completed", num(r.total));
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

      const lineRows = catLines.map(({ code, line }) => {
        const b = bucketsByCode.get(code.id) ?? { planned: 0, inProcess: 0, completed: 0 };
        return {
          id: line!.id,
          costCodeId: code.id,
          code: code.code,
          name: code.name,
          budget: num(line!.uwAmount),
          planned: b.planned,
          inProcess: b.inProcess,
          completed: b.completed,
          perUnitAmount: line!.perUnitAmount ? num(line!.perUnitAmount) : null,
          plannedUnits: line!.plannedUnits ?? null,
          isInterior: code.isInterior,
          note: line!.note,
          projects: projectsByCode.get(code.id) ?? [],
        };
      });

      return {
        code: cat.code,
        name: cat.name,
        division: cat.division,
        budget: lineRows.reduce((s, l) => s + l.budget, 0),
        planned: lineRows.reduce((s, l) => s + l.planned, 0),
        inProcess: lineRows.reduce((s, l) => s + l.inProcess, 0),
        completed: lineRows.reduce((s, l) => s + l.completed, 0),
        lines: lineRows,
      } satisfies BudgetCategory;
    })
    .filter((c): c is BudgetCategory => c !== null);

  // Group categories into the broad divisions (Exterior / Amenities / Interiors
  // / Fees) for the overview, in canonical order; anything unassigned sinks to
  // the end.
  const divisionOrder = new Map<string, number>(DIVISIONS.map((d, i) => [d.key, i]));
  const byDivision = new Map<string, BudgetCategory[]>();
  for (const cat of budgetCategories) {
    const key = cat.division ?? "unassigned";
    (byDivision.get(key) ?? byDivision.set(key, []).get(key)!).push(cat);
  }
  const budgetDivisions: BudgetDivision[] = [...byDivision.entries()]
    .sort(([a], [b]) => (divisionOrder.get(a) ?? 99) - (divisionOrder.get(b) ?? 99))
    .map(([key, cats]) => ({
      key,
      label: key === "unassigned" ? "Unassigned" : divisionLabel(key),
      budget: cats.reduce((s, c) => s + c.budget, 0),
      planned: cats.reduce((s, c) => s + c.planned, 0),
      inProcess: cats.reduce((s, c) => s + c.inProcess, 0),
      completed: cats.reduce((s, c) => s + c.completed, 0),
      categories: cats,
    }));

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

      {chart && (
        <PropertyChartControl
          propertyId={property.id}
          chartId={chart.id}
          chartName={chart.name}
          charts={allCharts}
          locked={glCount > 0}
          glCount={glCount}
          budgetLineCount={lines.length}
          codedProjectCount={codedProjects}
        />
      )}

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
          <BudgetView propertyId={property.id} divisions={budgetDivisions} />
        </CardContent>
      </Card>
    </div>
  );
}

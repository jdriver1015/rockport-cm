import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { Button } from "@/components/ui/button";
import { PropertyHeader } from "@/components/property-header";
import { PropertyNav } from "@/components/property-nav";
import { InteriorManageMenu } from "@/components/interior-manage-menu";
import { KpiStrip } from "@/components/ui/kpi-strip";
import { num } from "@/lib/format";
import { buildInteriorKpis } from "@/lib/interior-kpis";
import { computeInteriorBudgetFor } from "@/lib/interior-budget";

export const dynamic = "force-dynamic";

export default async function InteriorsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const property = await db().query.properties.findFirst({
    where: eq(schema.properties.slug, slug),
  });
  if (!property) notFound();
  const propertyId = property.id;

  const [interiorProjects, jtdRows, budget] = await Promise.all([
    db()
      .select({
        id: schema.projects.id,
        phase: schema.projects.phase,
        budgetAmount: schema.projects.budgetAmount,
        startDate: schema.projects.startDate,
        completeDate: schema.projects.completeDate,
      })
      .from(schema.projects)
      .leftJoin(schema.units, eq(schema.projects.unitId, schema.units.id))
      .where(
        and(
          eq(schema.projects.propertyId, propertyId),
          eq(schema.projects.kind, "unit"),
          isNull(schema.projects.archivedAt),
        ),
      )
      .orderBy(desc(schema.projects.createdAt)),
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
    // Planned units come from the same compute the Budget pivot uses, so the
    // strip and the pivot cannot disagree about the size of the plan.
    //
    // Guarded: this is many queries behind one KPI figure, and a statement
    // timeout under pooler contention has taken a page down in this app before.
    // The list of turns is the point of the screen — it must render without it.
    computeInteriorBudgetFor(propertyId).catch((err) => {
      console.error("unit upgrades: interior plan failed to load", err);
      return null;
    }),
  ]);

  const jtdByProject = new Map(jtdRows.map((r) => [r.projectId, num(r.total)]));

  const kpis = buildInteriorKpis({
    plannedUnits: budget ? budget.columns.reduce((n, c) => n + c.plannedUnits, 0) : null,
    projects: interiorProjects.map((p) => ({
      phase: p.phase,
      budgetAmount: num(p.budgetAmount),
      startDate: p.startDate,
      completeDate: p.completeDate,
      reconciled: jtdByProject.get(p.id) ?? 0,
    })),
  });



  return (
    <div className="space-y-6">
      <PropertyHeader
        property={property}
        action={
          <div className="flex items-center gap-2">
            <InteriorManageMenu slug={slug} />
            <Button render={<Link href={`/properties/${slug}/interiors/new`} />} nativeButton={false}>
              New Unit Upgrade
            </Button>
          </div>
        }
      />

      <PropertyNav slug={property.slug} />

      <KpiStrip items={kpis} />

      {/*
        The list of turns moved to Projects.
        
        This page used to hold both a project list and the turn programme, and
        the list duplicated the Projects tab in a table that could not do
        Kanban, Gantt, grouping, sorting or schedule health. A turn and a
        common-area job differ in how they are scoped and priced, not in what
        they are afterwards, so they are one list now.
        
        What is left here is the programme: how many turns, how far along, and
        against what budget. The plan itself — tiers, planned units, cost per
        unit — is on the Budget tab, where it always was.
      */}
      <div className="rounded-card border border-border bg-card px-4 py-3.5">
        <p className="text-[13px] text-ink-600">
          Individual turns live on the{" "}
          <Link
            href={`/properties/${slug}?group=kind`}
            className="text-link underline underline-offset-2 hover:text-navy"
          >
            Projects tab
          </Link>
          , grouped by type alongside common-area work.
        </p>
        <p className="mt-1 text-[12px] text-muted-foreground">
          The tiers and per-unit budgets behind these figures are on the{" "}
          <Link
            href={`/properties/${slug}/budget`}
            className="text-link underline underline-offset-2 hover:text-navy"
          >
            Budget tab
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
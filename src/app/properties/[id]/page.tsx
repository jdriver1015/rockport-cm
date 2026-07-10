import Link from "next/link";
import { notFound } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PropertyNav } from "@/components/property-nav";
import { money } from "@/lib/format";
import { PROJECT_STAGES, stageLabel } from "@/lib/stages";

export const dynamic = "force-dynamic";

export default async function PropertyOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const propertyId = Number(id);
  if (!Number.isInteger(propertyId)) notFound();

  const property = await db().query.properties.findFirst({
    where: eq(schema.properties.id, propertyId),
  });
  if (!property) notFound();

  const [budget] = await db()
    .select({ total: sql<string>`coalesce(sum(${schema.budgetLines.uwAmount}), 0)` })
    .from(schema.budgetLines)
    .where(eq(schema.budgetLines.propertyId, propertyId));

  const [agg] = await db()
    .select({
      committed: sql<string>`coalesce(sum(${schema.projects.committedCost}), 0)`,
      projectBudget: sql<string>`coalesce(sum(${schema.projects.budgetAmount}), 0)`,
      total: sql<number>`count(*)::int`,
    })
    .from(schema.projects)
    .where(eq(schema.projects.propertyId, propertyId));

  const [jtd] = await db()
    .select({ total: sql<string>`coalesce(sum(${schema.glTransactions.amount}), 0)` })
    .from(schema.glTransactions)
    .where(
      sql`${schema.glTransactions.propertyId} = ${propertyId} and ${schema.glTransactions.status} = 'posted'`,
    );

  const stageCounts = await db()
    .select({
      stage: schema.projects.stage,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.projects)
    .where(eq(schema.projects.propertyId, propertyId))
    .groupBy(schema.projects.stage);

  const countByStage = new Map(stageCounts.map((r) => [r.stage as string, r.count]));
  const uw = parseFloat(budget.total);
  const jtdN = parseFloat(jtd.total);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-[#1b355d]">{property.name}</h1>
        <p className="text-sm text-muted-foreground">
          {[property.entity, [property.city, property.state].filter(Boolean).join(", ")]
            .filter(Boolean)
            .join(" · ") || "—"}
          {property.unitCount ? ` · ${property.unitCount} units` : ""}
          {property.glUpdatedThru ? ` · GL thru ${property.glUpdatedThru}` : ""}
        </p>
      </div>

      <PropertyNav propertyId={property.id} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "UW Budget", value: money(uw) },
          { label: "Project Budgets", value: money(agg.projectBudget) },
          { label: "Committed", value: money(agg.committed) },
          { label: "JTD Actual", value: money(jtdN) },
        ].map((kpi) => (
          <Card key={kpi.label}>
            <CardHeader className="pb-1">
              <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {kpi.label}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold tabular-nums text-[#1b355d]">
              {kpi.value}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex-row items-baseline justify-between">
          <CardTitle className="text-base text-[#1b355d]">
            Projects by stage
          </CardTitle>
          <Link
            href={`/properties/${property.id}/projects`}
            className="text-sm text-[#1457a5] hover:underline"
          >
            View all {agg.total} →
          </Link>
        </CardHeader>
        <CardContent>
          {agg.total === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No projects yet — add the first one from the Projects tab.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {PROJECT_STAGES.map((s) => {
                const count = countByStage.get(s.key) ?? 0;
                return (
                  <Badge key={s.key} variant={count > 0 ? "secondary" : "outline"}>
                    {stageLabel(s.key)}: {count}
                  </Badge>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { KpiStrip } from "@/components/ui/kpi-strip";
import { AddRentRollDialog } from "@/components/add-rent-roll-dialog";
import { RentRollBatchRow } from "@/components/rent-roll-batch-row";
import { PropertyHeader } from "@/components/property-header";
import { PropertyNav } from "@/components/property-nav";
import { PerformanceViewSwitch } from "@/components/performance-view-switch";
import { parsePerformanceView } from "@/lib/performance-views";
import { buildInteriorKpis } from "@/lib/interior-kpis";
import { computeInteriorBudgetFor } from "@/lib/interior-budget";
import { computeTurnPerformanceFor } from "@/lib/turn-performance-data";
import { computeRentRollTrendFor } from "@/lib/rent-roll-trend";
import { RentRollTrend } from "@/components/rent-roll-trend-panel";
import {
  AwaitingLease,
  LatestLeases,
  OutcomeLegend,
  TradeOutByFloorplan,
  TurnPerformanceKpis,
  TurnPerformancePending,
} from "@/components/turn-performance-panels";
import { num } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function PerformancePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { slug } = await params;
  const view = parsePerformanceView((await searchParams).view);

  const property = await db().query.properties.findFirst({ where: eq(schema.properties.slug, slug) });
  if (!property) notFound();
  const propertyId = property.id;

  const [batches, [archivedCount]] = await Promise.all([
    db()
      .select()
      .from(schema.rentRollBatches)
      .where(
        and(
          eq(schema.rentRollBatches.propertyId, propertyId),
          isNull(schema.rentRollBatches.archivedAt),
        ),
      )
      .orderBy(desc(schema.rentRollBatches.asOfDate), desc(schema.rentRollBatches.createdAt)),
    db()
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.rentRollBatches)
      .where(
        and(
          eq(schema.rentRollBatches.propertyId, propertyId),
          isNotNull(schema.rentRollBatches.archivedAt),
        ),
      ),
  ]);

  return (
    <div className="space-y-6">
      <PropertyHeader property={property} />

      <PropertyNav slug={property.slug} />

      <div className="flex items-center justify-between gap-3">
        <PerformanceViewSwitch value={view} />
        {view === "rent-rolls" && (
          <div className="flex items-center gap-3">
            {archivedCount.count > 0 && (
              <Link
                href={`/properties/${slug}/rent-rolls/archived`}
                className="text-sm text-link hover:underline"
              >
                Archived ({archivedCount.count})
              </Link>
            )}
            <AddRentRollDialog propertyId={property.id} propertySlug={property.slug} />
          </div>
        )}
      </div>

      {view === "performance" ? (
        <PerformanceView propertyId={propertyId} slug={slug} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-navy">Rent roll snapshots</CardTitle>
          </CardHeader>
          <CardContent>
            {batches.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No rent rolls yet. Click <span className="font-medium">Add rent roll</span> to upload
                your first snapshot (Excel, CSV, or PDF).
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>File</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>As of</TableHead>
                      <TableHead>Uploaded</TableHead>
                      <TableHead className="text-right">Units</TableHead>
                      <TableHead className="text-right">Occupancy</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {batches.map((b) => (
                      <RentRollBatchRow key={b.id} propertySlug={property.slug} batch={b} />
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/**
 * How the turn programme is actually doing.
 *
 * Two halves that answer different questions and come from different places:
 * the KPI strip is execution (how many turns, how fast, against what budget),
 * carried over from the Turn Plan tab this page replaced. Everything below it
 * is return — trade-out, goal attainment and yield — derived by tracking a
 * turned unit across successive rent rolls.
 */
async function PerformanceView({ propertyId, slug }: { propertyId: number; slug: string }) {
  const [interiorProjects, jtdRows, budget, perf, trend] = await Promise.all([
    db()
      .select({
        id: schema.projects.id,
        phase: schema.projects.phase,
        budgetAmount: schema.projects.budgetAmount,
        startDate: schema.projects.startDate,
        completeDate: schema.projects.completeDate,
      })
      .from(schema.projects)
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
    computeInteriorBudgetFor(propertyId).catch((err) => {
      console.error("performance: interior plan failed to load", err);
      return null;
    }),
    computeTurnPerformanceFor(propertyId),
    computeRentRollTrendFor(propertyId),
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

  // Trade-out is a comparison BETWEEN snapshots, so one roll can never produce
  // one. Saying that plainly beats a screen of em dashes that looks broken.
  const canMeasure = perf.snapshotCount >= 2;

  return (
    <div className="space-y-6">
      <KpiStrip items={kpis} />

      {canMeasure ? (
        <>
          <TurnPerformanceKpis perf={perf} />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <OutcomeLegend perf={perf} />
            <TurnPerformancePending perf={perf} />
          </div>
          <TradeOutByFloorplan rows={perf.byFloorplan} />
          <LatestLeases outcomes={perf.outcomes} propertySlug={slug} />
          <AwaitingLease outcomes={perf.outcomes} propertySlug={slug} />
        </>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-navy">Trade-out &amp; ROI</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="py-6 text-center text-[13px] text-muted-foreground">
              Trade-out is measured by comparing a unit&apos;s rent before its turn against the
              lease signed after it, so it needs at least two committed rent rolls.{" "}
              {perf.snapshotCount === 0
                ? "None have been committed yet."
                : "One is committed so far."}{" "}
              <Link
                href={`/properties/${slug}/rent-rolls?view=rent-rolls`}
                className="text-link underline underline-offset-2 hover:text-navy"
              >
                Upload the next snapshot
              </Link>{" "}
              and these figures start filling in.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Outside the trade-out gate on purpose: a single snapshot cannot show a
          trade-out but is still a real occupancy and rent picture, and that is
          the half of the tab a property can use from day one. */}
      <RentRollTrend points={trend} propertySlug={slug} />
    </div>
  );
}

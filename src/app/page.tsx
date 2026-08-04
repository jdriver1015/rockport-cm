import Link from "next/link";
import { eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { money, num } from "@/lib/format";
import { bucketForPhase } from "@/lib/stage-buckets";
import { computeInteriorBudgets } from "@/lib/interior-budget";

export const dynamic = "force-dynamic";

export default async function PortfolioPage() {
  const properties = await db().select().from(schema.properties);
  const propertyIds = properties.map((p) => p.id);

  // Independent portfolio rollups — run in parallel instead of sequential
  // round-trips.
  const [budgetTotals, jtdTotals, projectRows, projectJtdRows, interiorBudgets] = await Promise.all([
    // Split by interior/non-interior: where a property has an interior plan, its
    // interior figure comes from the plan and the hand-entered interior lines are
    // superseded. Summing both would double-count.
    db()
      .select({
        propertyId: schema.budgetLines.propertyId,
        isInterior: schema.costCodes.isInterior,
        total: sql<string>`coalesce(sum(${schema.budgetLines.uwAmount}), 0)`,
      })
      .from(schema.budgetLines)
      .innerJoin(schema.costCodes, eq(schema.budgetLines.costCodeId, schema.costCodes.id))
      .where(isNull(schema.budgetLines.archivedAt))
      .groupBy(schema.budgetLines.propertyId, schema.costCodes.isInterior),
    db()
      .select({
        propertyId: schema.glTransactions.propertyId,
        total: sql<string>`coalesce(sum(${schema.glTransactions.amount}), 0)`,
      })
      .from(schema.glTransactions)
      .where(sql`${schema.glTransactions.status} = 'posted'`)
      .groupBy(schema.glTransactions.propertyId),
    db()
      .select({
        id: schema.projects.id,
        propertyId: schema.projects.propertyId,
        phase: schema.projects.phase,
        committedCost: schema.projects.committedCost,
      })
      .from(schema.projects)
      .where(isNull(schema.projects.archivedAt)),
    db()
      .select({
        projectId: schema.glTransactions.projectId,
        total: sql<string>`coalesce(sum(${schema.glTransactions.amount}), 0)`,
      })
      .from(schema.glTransactions)
      .where(sql`${schema.glTransactions.status} = 'posted' and ${schema.glTransactions.projectId} is not null`)
      .groupBy(schema.glTransactions.projectId),
    computeInteriorBudgets(propertyIds),
  ]);

  const manualBy = new Map<number, { interior: number; other: number }>();
  for (const r of budgetTotals) {
    const e = manualBy.get(r.propertyId) ?? { interior: 0, other: 0 };
    if (r.isInterior) e.interior += parseFloat(r.total);
    else e.other += parseFloat(r.total);
    manualBy.set(r.propertyId, e);
  }

  // Effective budget = non-interior lines + (plan-derived interiors when a plan
  // exists, else the hand-entered interior lines).
  const budgetBy = new Map<number, number>(
    properties.map((p) => {
      const manual = manualBy.get(p.id) ?? { interior: 0, other: 0 };
      const interior = interiorBudgets.get(p.id);
      return [p.id, manual.other + (interior?.hasPlan ? interior.total : manual.interior)];
    }),
  );
  const jtdBy = new Map(jtdTotals.map((r) => [r.propertyId, parseFloat(r.total)]));

  // Committed cost split by lifecycle bucket — Planned (scoped/bid/ready) vs
  // In Process (underway). Never hide real spend: a project can have posted
  // GL before its contract amount was recorded, so each bucket takes whichever
  // is larger, per project, before rolling up to the property.
  const jtdByProject = new Map(projectJtdRows.map((r) => [r.projectId, num(r.total)]));
  const committedBy = new Map<number, { planned: number; inProcess: number }>();
  for (const p of projectRows) {
    const bucket = bucketForPhase(p.phase);
    if (bucket === "completed") continue;
    const amount = Math.max(num(p.committedCost), jtdByProject.get(p.id) ?? 0);
    const entry = committedBy.get(p.propertyId) ?? { planned: 0, inProcess: 0 };
    entry[bucket === "planned" ? "planned" : "inProcess"] += amount;
    committedBy.set(p.propertyId, entry);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-serif text-2xl font-semibold text-navy">Portfolio</h1>
          <p className="text-sm text-muted-foreground">All properties with active construction</p>
        </div>
        <Button render={<Link href="/properties/new" />} nativeButton={false}>
          New property
        </Button>
      </div>

      {properties.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No properties yet. Create the first one to get started.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {properties.map((p) => {
            const uw = budgetBy.get(p.id) ?? 0;
            const jtd = jtdBy.get(p.id) ?? 0;
            const committed = committedBy.get(p.id) ?? { planned: 0, inProcess: 0 };
            const pct = uw > 0 ? Math.round((jtd / uw) * 100) : 0;
            return (
              <Link key={p.id} href={`/properties/${p.slug}/budget`} className="group">
                <Card className="h-full transition-shadow group-hover:shadow-md">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base text-navy">{p.name}</CardTitle>
                    <p className="text-xs text-muted-foreground">
                      {[p.city, p.state].filter(Boolean).join(", ") || "—"}
                      {p.unitCount ? ` · ${p.unitCount} units` : ""}
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Budgeted</span>
                      <span className="font-medium tabular-nums">{money(uw)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Planned</span>
                      <span className="font-medium tabular-nums">{money(committed.planned)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">In Process</span>
                      <span className="font-medium tabular-nums">{money(committed.inProcess)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Completed</span>
                      <span className="font-medium tabular-nums">{money(jtd)}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-track">
                      <div
                        className="h-full rounded-full bg-ink-900"
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </div>
                    <p className="text-right text-xs text-muted-foreground">
                      {pct}% of budget spent
                    </p>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

import Link from "next/link";
import { isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { money } from "@/lib/format";
import { STAGE_BUCKETS } from "@/lib/stage-buckets";

const PLANNED_STAGES = [...STAGE_BUCKETS.find((b) => b.key === "planned")!.stages];
const IN_PROCESS_STAGES = [...STAGE_BUCKETS.find((b) => b.key === "in_process")!.stages];

export const dynamic = "force-dynamic";

export default async function PortfolioPage() {
  // Independent portfolio rollups — run in parallel instead of four sequential
  // round-trips.
  const [properties, budgetTotals, jtdTotals, committedTotals] = await Promise.all([
    db().select().from(schema.properties),
    db()
      .select({
        propertyId: schema.budgetLines.propertyId,
        total: sql<string>`coalesce(sum(${schema.budgetLines.uwAmount}), 0)`,
      })
      .from(schema.budgetLines)
      .where(isNull(schema.budgetLines.archivedAt))
      .groupBy(schema.budgetLines.propertyId),
    db()
      .select({
        propertyId: schema.glTransactions.propertyId,
        total: sql<string>`coalesce(sum(${schema.glTransactions.amount}), 0)`,
      })
      .from(schema.glTransactions)
      .where(sql`${schema.glTransactions.status} = 'posted'`)
      .groupBy(schema.glTransactions.propertyId),
    // Committed cost split by lifecycle bucket — Planned (scoped/bid/ready) vs
    // In Process (underway); Completed uses actual GL spend (jtdTotals) instead.
    db()
      .select({
        propertyId: schema.projects.propertyId,
        planned: sql<string>`coalesce(sum(${schema.projects.committedCost}) filter (where ${schema.projects.stage} = any(${PLANNED_STAGES})), 0)`,
        inProcess: sql<string>`coalesce(sum(${schema.projects.committedCost}) filter (where ${schema.projects.stage} = any(${IN_PROCESS_STAGES})), 0)`,
      })
      .from(schema.projects)
      .where(isNull(schema.projects.archivedAt))
      .groupBy(schema.projects.propertyId),
  ]);

  const budgetBy = new Map(budgetTotals.map((r) => [r.propertyId, parseFloat(r.total)]));
  const jtdBy = new Map(jtdTotals.map((r) => [r.propertyId, parseFloat(r.total)]));
  const committedBy = new Map(
    committedTotals.map((r) => [r.propertyId, { planned: parseFloat(r.planned), inProcess: parseFloat(r.inProcess) }]),
  );

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
              <Link key={p.id} href={`/properties/${p.id}/budget`} className="group">
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
                    <div className="h-1.5 overflow-hidden rounded-full bg-paper">
                      <div
                        className="h-full rounded-full bg-gold"
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

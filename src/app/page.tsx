import Link from "next/link";
import { eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { money } from "@/lib/format";
import { computeInteriorBudgets } from "@/lib/interior-budget";
import { readScheduleHealth, type ScheduleStatus } from "@/lib/target-slip";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function PortfolioPage() {
  const properties = await db().select().from(schema.properties);
  const propertyIds = properties.map((p) => p.id);

  // Independent portfolio rollups — run in parallel instead of sequential
  // round-trips.
  const [budgetTotals, jtdTotals, projectRows, interiorBudgets, plannedRows] =
    await Promise.all([
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
        kind: schema.projects.kind,
        phase: schema.projects.phase,
        committedCost: schema.projects.committedCost,
      })
      .from(schema.projects)
      .where(isNull(schema.projects.archivedAt)),
    computeInteriorBudgets(propertyIds),
    // Units planned into a renovation type — the real size of the turn
    // programme, where one has been planned.
    db()
      .select({
        propertyId: schema.interiorBudgetPlan.propertyId,
        planned: sql<number>`coalesce(sum(${schema.interiorBudgetPlan.plannedUnits}), 0)::int`,
      })
      .from(schema.interiorBudgetPlan)
      .groupBy(schema.interiorBudgetPlan.propertyId),
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

  // How much of the turn programme is actually done. The denominator is the
  // planned unit count where a plan exists — that is the real size of the
  // programme — and falls back to the number of turns created otherwise, so a
  // property that has not planned yet still reads sensibly.
  const plannedBy = new Map(plannedRows.map((r) => [r.propertyId, r.planned]));
  const turnsBy = new Map<number, { done: number; created: number }>();
  for (const p of projectRows) {
    if (p.kind !== "unit") continue;
    const e = turnsBy.get(p.propertyId) ?? { done: 0, created: 0 };
    e.created++;
    if (p.phase === "complete") e.done++;
    turnsBy.set(p.propertyId, e);
  }

  // Schedule health, rolled up worst-first: one late project makes the property
  // late. An average would let a single badly-slipped job hide behind a dozen
  // healthy ones, which is the opposite of what a portfolio scan is for.
  const health = await readScheduleHealth(projectRows.map((p) => p.id));
  const RANK: Record<ScheduleStatus, number> = { late: 3, slipping: 2, on_time: 1, unknown: 0 };
  const scheduleBy = new Map<number, { status: ScheduleStatus; late: number }>();
  for (const p of projectRows) {
    const h = health.get(p.id);
    if (!h) continue;
    const e = scheduleBy.get(p.propertyId) ?? { status: "unknown" as ScheduleStatus, late: 0 };
    if (RANK[h.status] > RANK[e.status]) e.status = h.status;
    if (h.status === "late") e.late++;
    scheduleBy.set(p.propertyId, e);
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
            const spentPct = uw > 0 ? Math.round((jtd / uw) * 100) : 0;
            const turns = turnsBy.get(p.id) ?? { done: 0, created: 0 };
            const target = plannedBy.get(p.id) || turns.created;
            const turnPct = target > 0 ? Math.round((turns.done / target) * 100) : 0;
            const sched = scheduleBy.get(p.id);
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
                      <span className="text-muted-foreground">Total budget</span>
                      <span className="font-medium tabular-nums">{money(uw)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Spent</span>
                      {/* Nothing posted is a different fact from nothing spent,
                          and on a scan the honest label prevents a property
                          being read as under budget when it is unreported. */}
                      {jtd > 0 ? (
                        <span className="font-medium tabular-nums">
                          {money(jtd)}{" "}
                          <span className="font-normal text-muted-foreground">· {spentPct}%</span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">No GL posted</span>
                      )}
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Turns</span>
                      <span className="font-medium tabular-nums">
                        {target > 0 ? `${turns.done} of ${target}` : "—"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Schedule</span>
                      <ScheduleChip status={sched?.status} late={sched?.late ?? 0} />
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-track">
                      <div
                        className="h-full rounded-full bg-ink-900"
                        style={{ width: `${Math.min(turnPct, 100)}%` }}
                      />
                    </div>
                    <p className="text-right text-xs text-muted-foreground">
                      {turnPct}% of units turned
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

const CHIP: Record<ScheduleStatus, { label: string; className: string }> = {
  on_time: { label: "On track", className: "text-positive" },
  slipping: { label: "Slipping", className: "text-pending" },
  late: { label: "Late", className: "text-alert" },
  unknown: { label: "No dates", className: "text-muted-foreground" },
};

/** Worst status across the property's projects, with the count when it is bad. */
function ScheduleChip({ status, late }: { status?: ScheduleStatus; late: number }) {
  const s = CHIP[status ?? "unknown"];
  return (
    <span className={cn("text-sm font-medium", s.className)}>
      {s.label}
      {late > 0 && <span className="font-normal"> · {late} late</span>}
    </span>
  );
}

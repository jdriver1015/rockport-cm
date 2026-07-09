import Link from "next/link";
import { sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { money } from "@/lib/format";
import { stageLabel } from "@/lib/stages";

export const dynamic = "force-dynamic";

export default async function PortfolioPage() {
  const projects = await db().select().from(schema.projects);

  const budgetTotals = await db()
    .select({
      projectId: schema.budgetLines.projectId,
      total: sql<string>`coalesce(sum(${schema.budgetLines.uwAmount}), 0)`,
    })
    .from(schema.budgetLines)
    .groupBy(schema.budgetLines.projectId);

  const jtdTotals = await db()
    .select({
      projectId: schema.glTransactions.projectId,
      total: sql<string>`coalesce(sum(${schema.glTransactions.amount}), 0)`,
    })
    .from(schema.glTransactions)
    .where(sql`${schema.glTransactions.status} = 'posted'`)
    .groupBy(schema.glTransactions.projectId);

  const budgetByProject = new Map(budgetTotals.map((r) => [r.projectId, parseFloat(r.total)]));
  const jtdByProject = new Map(jtdTotals.map((r) => [r.projectId, parseFloat(r.total)]));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-[#1b355d]">Portfolio</h1>
          <p className="text-sm text-muted-foreground">
            All active construction projects
          </p>
        </div>
        <Button render={<Link href="/projects/new" />}>New project</Button>
      </div>

      {projects.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No projects yet. Create the first one to get started.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => {
            const uw = budgetByProject.get(p.id) ?? 0;
            const jtd = jtdByProject.get(p.id) ?? 0;
            const pct = uw > 0 ? Math.round((jtd / uw) * 100) : 0;
            return (
              <Link key={p.id} href={`/projects/${p.id}`} className="group">
                <Card className="h-full transition-shadow group-hover:shadow-md">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-base text-[#1b355d]">{p.name}</CardTitle>
                      <Badge variant="secondary">{stageLabel(p.stage)}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {[p.city, p.state].filter(Boolean).join(", ") || "—"}
                      {p.unitCount ? ` · ${p.unitCount} units` : ""}
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">UW Budget</span>
                      <span className="font-medium tabular-nums">{money(uw)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">JTD Actual</span>
                      <span className="font-medium tabular-nums">{money(jtd)}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-[#e8edf2]">
                      <div
                        className="h-full rounded-full bg-[#1457a5]"
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </div>
                    <p className="text-right text-xs text-muted-foreground">{pct}% of budget spent</p>
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

import Link from "next/link";
import { asc, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ChevronRight } from "lucide-react";
import { AddChartDialog, ChartRowActions } from "@/components/chart-list";

export const dynamic = "force-dynamic";

export default async function ChartsListPage() {
  const charts = await db()
    .select()
    .from(schema.chartsOfAccounts)
    .where(isNull(schema.chartsOfAccounts.archivedAt))
    .orderBy(asc(schema.chartsOfAccounts.name));

  const codeCounts = await db()
    .select({
      chartId: schema.costCodes.chartId,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.costCodes)
    .groupBy(schema.costCodes.chartId);
  const codesByChart = new Map(codeCounts.map((c) => [c.chartId, c.count]));

  const propCounts = await db()
    .select({
      chartId: schema.properties.chartOfAccountsId,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.properties)
    .groupBy(schema.properties.chartOfAccountsId);
  const propsByChart = new Map(propCounts.map((c) => [c.chartId, c.count]));

  const chartOptions = charts.map((c) => ({ id: c.id, name: c.name }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {charts.length} chart{charts.length === 1 ? "" : "s"} of accounts · each property binds to one
        </p>
        <AddChartDialog charts={chartOptions} />
      </div>

      <Card>
        <CardContent className="divide-y p-0">
          {charts.map((chart) => {
            const codes = codesByChart.get(chart.id) ?? 0;
            const props = propsByChart.get(chart.id) ?? 0;
            return (
              <div key={chart.id} className="flex items-center gap-3 px-4 py-3">
                <Link
                  href={`/settings/chart-of-accounts/${chart.id}`}
                  className="group flex min-w-0 flex-1 items-center gap-2"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-semibold text-navy group-hover:underline">
                        {chart.name}
                      </span>
                      {chart.isDefault && <Badge variant="outline">Default</Badge>}
                    </div>
                    {chart.description && (
                      <p className="truncate text-xs text-muted-foreground">{chart.description}</p>
                    )}
                  </div>
                </Link>
                <div className="hidden shrink-0 gap-4 text-right text-xs text-muted-foreground sm:flex">
                  <span className="tabular-nums">{codes} codes</span>
                  <span className="tabular-nums">
                    {props} propert{props === 1 ? "y" : "ies"}
                  </span>
                </div>
                <ChartRowActions
                  id={chart.id}
                  name={chart.name}
                  description={chart.description}
                  isDefault={chart.isDefault}
                  propertyCount={props}
                />
                <Link href={`/settings/chart-of-accounts/${chart.id}`}>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </Link>
              </div>
            );
          })}
          {charts.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              No charts yet. Add one to get started.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

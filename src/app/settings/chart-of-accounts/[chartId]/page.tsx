import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChevronLeft } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AddCategoryDialog,
  AddCostCodeDialog,
  CategoryDivisionSelect,
  EditCostCodeDialog,
} from "@/components/coa-editors";

export const dynamic = "force-dynamic";

export default async function ChartEditorPage({
  params,
}: {
  params: Promise<{ chartId: string }>;
}) {
  const { chartId: chartIdParam } = await params;
  const chartId = Number(chartIdParam);
  if (!Number.isInteger(chartId)) notFound();

  const chart = await db().query.chartsOfAccounts.findFirst({
    where: eq(schema.chartsOfAccounts.id, chartId),
  });
  if (!chart) notFound();

  const categories = await db()
    .select()
    .from(schema.costCategories)
    .where(eq(schema.costCategories.chartId, chartId))
    .orderBy(asc(schema.costCategories.sortOrder), asc(schema.costCategories.code));

  const codes = await db()
    .select()
    .from(schema.costCodes)
    .where(eq(schema.costCodes.chartId, chartId))
    .orderBy(asc(schema.costCodes.code));

  // GL usage for this chart's codes — drives the read-only "GL rows" column.
  const usage = await db()
    .select({
      costCodeId: schema.glTransactions.costCodeId,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.glTransactions)
    .innerJoin(schema.costCodes, eq(schema.glTransactions.costCodeId, schema.costCodes.id))
    .where(eq(schema.costCodes.chartId, chartId))
    .groupBy(schema.glTransactions.costCodeId);
  const usageByCode = new Map(usage.map((u) => [u.costCodeId, u.count]));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <Link
            href="/settings/chart-of-accounts"
            className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="size-3.5" /> All charts
          </Link>
          <div className="flex items-center gap-2">
            <h2 className="truncate text-lg font-semibold text-navy">{chart.name}</h2>
            {chart.isDefault && <Badge variant="outline">Default</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">
            {categories.length} categories · {codes.length} cost codes
          </p>
        </div>
        <div className="flex gap-2">
          <AddCategoryDialog chartId={chartId} />
          <AddCostCodeDialog chartId={chartId} categories={categories} />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base text-navy">Chart of accounts</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">GL rows</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Edit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {categories.map((cat) => {
                const catCodes = codes.filter((c) => c.categoryId === cat.id);
                return [
                  <TableRow key={`cat-${cat.id}`} className="bg-paper/60 hover:bg-paper/60">
                    <TableCell className="font-mono text-xs font-semibold text-navy">
                      {cat.code}
                    </TableCell>
                    <TableCell className="font-semibold text-navy" colSpan={4}>
                      {cat.name}
                    </TableCell>
                    <TableCell className="text-right">
                      <CategoryDivisionSelect id={cat.id} division={cat.division} />
                    </TableCell>
                  </TableRow>,
                  ...catCodes.map((c) => (
                    <TableRow key={c.id} className={c.active ? undefined : "opacity-55"}>
                      <TableCell className="pl-6 font-mono text-xs">{c.code}</TableCell>
                      <TableCell>{c.name}</TableCell>
                      <TableCell>
                        {c.isInterior ? (
                          <Badge variant="outline">Interior</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">Common</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {usageByCode.get(c.id) ?? "—"}
                      </TableCell>
                      <TableCell>
                        {c.active ? (
                          <span className="text-xs text-muted-foreground">Active</span>
                        ) : (
                          <Badge variant="outline">Inactive</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <EditCostCodeDialog
                          id={c.id}
                          code={c.code}
                          name={c.name}
                          active={c.active}
                          isInterior={c.isInterior}
                        />
                      </TableCell>
                    </TableRow>
                  )),
                ];
              })}
              {categories.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                    No categories yet. Add a category, then add cost codes under it.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

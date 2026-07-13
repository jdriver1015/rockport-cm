import { asc, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

export default async function ChartOfAccountsPage() {
  const categories = await db()
    .select()
    .from(schema.costCategories)
    .orderBy(asc(schema.costCategories.sortOrder), asc(schema.costCategories.code));

  const codes = await db()
    .select()
    .from(schema.costCodes)
    .orderBy(asc(schema.costCodes.code));

  const usage = await db()
    .select({
      costCodeId: schema.glTransactions.costCodeId,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.glTransactions)
    .groupBy(schema.glTransactions.costCodeId);
  const usageByCode = new Map(usage.map((u) => [u.costCodeId, u.count]));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {categories.length} categories · {codes.length} cost codes · shared across all properties
        </p>
        <div className="flex gap-2">
          <AddCategoryDialog />
          <AddCostCodeDialog categories={categories} />
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
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

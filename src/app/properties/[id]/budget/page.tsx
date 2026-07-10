import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BudgetImport } from "@/components/budget-import";
import { PropertyNav } from "@/components/property-nav";
import { money, moneyExact, num } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function BudgetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const propertyId = Number(id);
  if (!Number.isInteger(propertyId)) notFound();

  const property = await db().query.properties.findFirst({
    where: eq(schema.properties.id, propertyId),
  });
  if (!property) notFound();

  const categories = await db()
    .select()
    .from(schema.costCategories)
    .orderBy(asc(schema.costCategories.sortOrder));

  const codes = await db()
    .select()
    .from(schema.costCodes)
    .where(eq(schema.costCodes.active, true))
    .orderBy(asc(schema.costCodes.code));

  const lines = await db()
    .select()
    .from(schema.budgetLines)
    .where(eq(schema.budgetLines.propertyId, propertyId));

  const lineByCode = new Map(lines.map((l) => [l.costCodeId, l]));
  const grandTotal = lines.reduce((s, l) => s + num(l.uwAmount), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-[#1b355d]">{property.name}</h1>
        <p className="text-sm text-muted-foreground">
          Underwriting budget — benchmarks by cost code; projects roll up under these lines
        </p>
      </div>

      <PropertyNav propertyId={property.id} />

      <BudgetImport propertyId={property.id} />

      <Card>
        <CardHeader className="flex-row items-baseline justify-between">
          <CardTitle className="text-base text-[#1b355d]">UW Budget</CardTitle>
          <span className="text-lg font-semibold tabular-nums text-[#1b355d]">
            {money(grandTotal)}
          </span>
        </CardHeader>
        <CardContent>
          {lines.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No budget loaded yet — drop an Excel file above to import the underwriting budget.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Per unit</TableHead>
                  <TableHead className="text-right">Units</TableHead>
                  <TableHead className="text-right">UW Budget</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {categories.map((cat) => {
                  const catCodes = codes.filter((c) => c.categoryId === cat.id);
                  const catLines = catCodes
                    .map((c) => ({ code: c, line: lineByCode.get(c.id) }))
                    .filter((x) => x.line);
                  if (catLines.length === 0) return null;
                  const catTotal = catLines.reduce((s, x) => s + num(x.line!.uwAmount), 0);
                  return [
                    <TableRow key={`cat-${cat.id}`} className="bg-[#e8edf2]/60 hover:bg-[#e8edf2]/60">
                      <TableCell className="font-mono text-xs font-semibold text-[#1b355d]">
                        {cat.code}
                      </TableCell>
                      <TableCell className="font-semibold text-[#1b355d]">{cat.name}</TableCell>
                      <TableCell />
                      <TableCell />
                      <TableCell className="text-right font-semibold tabular-nums text-[#1b355d]">
                        {money(catTotal)}
                      </TableCell>
                    </TableRow>,
                    ...catLines.map(({ code, line }) => (
                      <TableRow key={code.id}>
                        <TableCell className="pl-6 font-mono text-xs">{code.code}</TableCell>
                        <TableCell>{code.name}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {line!.perUnitAmount ? moneyExact(line!.perUnitAmount) : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {line!.plannedUnits ?? "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {moneyExact(line!.uwAmount)}
                        </TableCell>
                      </TableRow>
                    )),
                  ];
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

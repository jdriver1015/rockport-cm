import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
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
import { PRICING_METHOD_LABELS, type PricingMethod } from "@/lib/pricing";
import {
  AddGroupLineDialog,
  EditGroupLineDialog,
  type ChartCodeOption,
} from "@/components/budget-line-editor";

export const dynamic = "force-dynamic";

export default async function BudgetGroupEditorPage({
  params,
}: {
  params: Promise<{ slug: string; typeId: string }>;
}) {
  const { slug, typeId: typeIdParam } = await params;
  const groupId = Number(typeIdParam);
  if (!Number.isInteger(groupId)) notFound();

  const property = await db().query.properties.findFirst({
    where: eq(schema.properties.slug, slug),
  });
  if (!property) notFound();
  const propertyId = property.id;

  const group = await db().query.budgetGroups.findFirst({
    where: eq(schema.budgetGroups.id, groupId),
  });
  if (!group || group.propertyId !== propertyId) notFound();

  const [lines, interiorCodes] = await Promise.all([
    db()
      .select()
      .from(schema.budgetGroupLines)
      .where(eq(schema.budgetGroupLines.budgetGroupId, groupId))
      .orderBy(asc(schema.budgetGroupLines.sortOrder), asc(schema.budgetGroupLines.id)),
    db()
      .select({ id: schema.costCodes.id, code: schema.costCodes.code, name: schema.costCodes.name })
      .from(schema.costCodes)
      .where(
        and(
          eq(schema.costCodes.chartId, property.chartOfAccountsId),
          eq(schema.costCodes.isInterior, true),
        ),
      )
      .orderBy(asc(schema.costCodes.code)),
  ]);
  const codeById = new Map<number, ChartCodeOption>(interiorCodes.map((c) => [c.id, c]));

  const money = (v: string | null) =>
    v == null ? "—" : `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/properties/${slug}/interiors`}
            className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="size-3.5" /> Interiors
          </Link>
          <h2 className="truncate text-lg font-semibold text-navy">{group.name}</h2>
          <p className="text-sm text-muted-foreground">
            {lines.length} line{lines.length === 1 ? "" : "s"}
            {group.description ? ` · ${group.description}` : ""}
          </p>
        </div>
        <AddGroupLineDialog propertyId={propertyId} budgetGroupId={groupId} interiorCodes={interiorCodes} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base text-navy">Budget lines</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cost code</TableHead>
                <TableHead>Pricing</TableHead>
                <TableHead className="text-right">Unit price</TableHead>
                <TableHead className="text-right">Default qty</TableHead>
                <TableHead className="w-1/3">Notes</TableHead>
                <TableHead className="text-right">Edit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((ln) => {
                const code = codeById.get(ln.costCodeId);
                return (
                  <TableRow key={ln.id}>
                    <TableCell className="font-medium text-navy">
                      {code ? code.name : `Code #${ln.costCodeId}`}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {PRICING_METHOD_LABELS[ln.pricingMethod as PricingMethod] ?? ln.pricingMethod}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{money(ln.unitPrice)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {ln.defaultQuantity != null ? Number(ln.defaultQuantity).toLocaleString() : "—"}
                    </TableCell>
                    <TableCell className="whitespace-normal text-sm text-muted-foreground">
                      {ln.notes ?? "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <EditGroupLineDialog
                        propertyId={propertyId}
                        budgetGroupId={groupId}
                        interiorCodes={interiorCodes}
                        line={{
                          id: ln.id,
                          costCodeId: ln.costCodeId,
                          pricingMethod: ln.pricingMethod as PricingMethod,
                          unitPrice: ln.unitPrice,
                          defaultQuantity: ln.defaultQuantity,
                          notes: ln.notes,
                        }}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
              {lines.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                    No budget lines yet. Add lines for each cost code in this package.
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

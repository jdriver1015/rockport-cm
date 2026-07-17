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
  AddGroupItemDialog,
  EditGroupItemDialog,
  type ChartCodeOption,
} from "@/components/scope-group-item-editor";

export const dynamic = "force-dynamic";

export default async function ScopeGroupEditorPage({
  params,
}: {
  params: Promise<{ id: string; groupId: string }>;
}) {
  const { id, groupId: groupIdParam } = await params;
  const propertyId = Number(id);
  const groupId = Number(groupIdParam);
  if (!Number.isInteger(propertyId) || !Number.isInteger(groupId)) notFound();

  const property = await db().query.properties.findFirst({
    where: eq(schema.properties.id, propertyId),
  });
  if (!property) notFound();

  const group = await db().query.scopeGroups.findFirst({
    where: eq(schema.scopeGroups.id, groupId),
  });
  if (!group || group.propertyId !== propertyId) notFound();

  const [items, interiorCodes] = await Promise.all([
    db()
      .select()
      .from(schema.scopeGroupItems)
      .where(eq(schema.scopeGroupItems.scopeGroupId, groupId))
      .orderBy(asc(schema.scopeGroupItems.sortOrder), asc(schema.scopeGroupItems.id)),
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
            href={`/properties/${propertyId}/interiors`}
            className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="size-3.5" /> Interiors
          </Link>
          <h2 className="truncate text-lg font-semibold text-navy">{group.name}</h2>
          <p className="text-sm text-muted-foreground">
            {items.length} item{items.length === 1 ? "" : "s"}
            {group.description ? ` · ${group.description}` : ""}
          </p>
        </div>
        <AddGroupItemDialog propertyId={propertyId} scopeGroupId={groupId} interiorCodes={interiorCodes} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base text-navy">Scope items</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Pricing</TableHead>
                <TableHead className="text-right">Unit price</TableHead>
                <TableHead>Code</TableHead>
                <TableHead className="text-right">Edit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((it) => {
                const code = it.costCodeId != null ? codeById.get(it.costCodeId) : undefined;
                return (
                  <TableRow key={it.id} className={it.active ? undefined : "opacity-55"}>
                    <TableCell className="font-medium text-navy">{it.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{it.category ?? "—"}</TableCell>
                    <TableCell className="text-sm">
                      {PRICING_METHOD_LABELS[it.pricingMethod as PricingMethod] ?? it.pricingMethod}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{money(it.unitPrice)}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {code ? code.code : it.costCodeId != null ? "?" : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <EditGroupItemDialog
                        propertyId={propertyId}
                        scopeGroupId={groupId}
                        interiorCodes={interiorCodes}
                        item={{
                          id: it.id,
                          name: it.name,
                          category: it.category,
                          pricingMethod: it.pricingMethod as PricingMethod,
                          unitPrice: it.unitPrice,
                          defaultQuantity: it.defaultQuantity,
                          quantityFormula: it.quantityFormula,
                          costCodeId: it.costCodeId,
                          laborAssumptions: it.laborAssumptions,
                          materialAssumptions: it.materialAssumptions,
                          notes: it.notes,
                        }}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
              {items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                    No items yet. Add scope items to this package.
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

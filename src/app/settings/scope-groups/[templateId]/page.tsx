import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
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
import { PRICING_METHOD_LABELS, type PricingMethod } from "@/lib/pricing";
import {
  AddTemplateItemDialog,
  EditTemplateItemDialog,
  type InteriorCodeOption,
} from "@/components/scope-template-editor";

export const dynamic = "force-dynamic";

export default async function ScopeTemplateEditorPage({
  params,
}: {
  params: Promise<{ templateId: string }>;
}) {
  const { templateId: templateIdParam } = await params;
  const templateId = Number(templateIdParam);
  if (!Number.isInteger(templateId)) notFound();

  const template = await db().query.scopeGroupTemplates.findFirst({
    where: eq(schema.scopeGroupTemplates.id, templateId),
  });
  if (!template) notFound();

  const items = await db()
    .select()
    .from(schema.scopeGroupTemplateItems)
    .where(eq(schema.scopeGroupTemplateItems.templateId, templateId))
    .orderBy(asc(schema.scopeGroupTemplateItems.sortOrder), asc(schema.scopeGroupTemplateItems.id));

  // Suggest 4000-series interior codes from the default chart (templates store
  // the code as a string, resolved to each property's chart when instantiated).
  const defaultChart = await db().query.chartsOfAccounts.findFirst({
    where: eq(schema.chartsOfAccounts.isDefault, true),
  });
  const interiorCodes: InteriorCodeOption[] = defaultChart
    ? await db()
        .select({ code: schema.costCodes.code, name: schema.costCodes.name })
        .from(schema.costCodes)
        .where(and(eq(schema.costCodes.chartId, defaultChart.id), eq(schema.costCodes.isInterior, true)))
        .orderBy(asc(schema.costCodes.code))
    : [];

  const money = (v: string | null) =>
    v == null ? "—" : `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <Link
            href="/settings/scope-groups"
            className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="size-3.5" /> All templates
          </Link>
          <div className="flex items-center gap-2">
            <h2 className="truncate text-lg font-semibold text-navy">{template.name}</h2>
            {!template.active && <Badge variant="outline">Inactive</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">
            {items.length} item{items.length === 1 ? "" : "s"}
          </p>
        </div>
        <AddTemplateItemDialog templateId={templateId} interiorCodes={interiorCodes} />
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
              {items.map((it) => (
                <TableRow key={it.id} className={it.active ? undefined : "opacity-55"}>
                  <TableCell className="font-medium text-navy">{it.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{it.category ?? "—"}</TableCell>
                  <TableCell className="text-sm">
                    {PRICING_METHOD_LABELS[it.pricingMethod as PricingMethod] ?? it.pricingMethod}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{money(it.unitPrice)}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {it.costCodeRef ?? "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <EditTemplateItemDialog
                      templateId={templateId}
                      item={{
                        id: it.id,
                        name: it.name,
                        category: it.category,
                        pricingMethod: it.pricingMethod as PricingMethod,
                        unitPrice: it.unitPrice,
                        defaultQuantity: it.defaultQuantity,
                        quantityFormula: it.quantityFormula,
                        costCodeRef: it.costCodeRef,
                        laborAssumptions: it.laborAssumptions,
                        materialAssumptions: it.materialAssumptions,
                        notes: it.notes,
                      }}
                      interiorCodes={interiorCodes}
                    />
                  </TableCell>
                </TableRow>
              ))}
              {items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                    No items yet. Add scope items (e.g. Flooring, Paint, Appliances) to this package.
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

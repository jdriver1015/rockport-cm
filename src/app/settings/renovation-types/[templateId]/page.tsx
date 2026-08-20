import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
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
  AddTemplateLineDialog,
  EditTemplateLineDialog,
  type InteriorCodeOption,
} from "@/components/budget-template-line-editor";
import { TradeScopeSection, type CopySource } from "@/components/trade-scope-section";
import { mergeTradeScopes } from "@/lib/trade-scope";
import { listTradeScopeRows } from "@/lib/trade-scope-store";

export const dynamic = "force-dynamic";

const money = (v: string | null) =>
  v == null ? "—" : `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default async function BudgetTemplateEditorPage({
  params,
}: {
  params: Promise<{ templateId: string }>;
}) {
  const { templateId: templateIdParam } = await params;
  const templateId = Number(templateIdParam);
  if (!Number.isInteger(templateId)) notFound();

  const template = await db().query.budgetTemplates.findFirst({
    where: eq(schema.budgetTemplates.id, templateId),
  });
  if (!template) notFound();

  // This template's written scopes, plus per-template counts so the copy
  // buttons can offer only sources that actually have wording.
  const [scopeRows, scopeCounts, otherTemplates] = await Promise.all([
    listTradeScopeRows({ level: "template", templateId }),
    db()
      .select({
        templateId: schema.tradeScopes.templateId,
        count: sql<number>`count(*) filter (where btrim(coalesce(${schema.tradeScopes.body}, '')) <> '')::int`,
      })
      .from(schema.tradeScopes)
      .groupBy(schema.tradeScopes.templateId),
    db()
      .select({ id: schema.budgetTemplates.id, name: schema.budgetTemplates.name })
      .from(schema.budgetTemplates)
      .where(and(isNull(schema.budgetTemplates.archivedAt), ne(schema.budgetTemplates.id, templateId)))
      .orderBy(asc(schema.budgetTemplates.sortOrder), asc(schema.budgetTemplates.name)),
  ]);

  const scopeEntries = mergeTradeScopes(scopeRows);
  const writtenByTemplate = new Map(
    scopeCounts.filter((c) => c.templateId != null).map((c) => [c.templateId!, c.count]),
  );
  const copySources: CopySource[] = otherTemplates
    .map((t) => ({
      owner: { level: "template" as const, templateId: t.id },
      label: t.name,
      writtenCount: writtenByTemplate.get(t.id) ?? 0,
    }))
    .filter((t) => t.writtenCount > 0);

  const lines = await db()
    .select()
    .from(schema.budgetTemplateLines)
    .where(eq(schema.budgetTemplateLines.templateId, templateId))
    .orderBy(asc(schema.budgetTemplateLines.sortOrder), asc(schema.budgetTemplateLines.id));

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

  const codeNameMap = new Map(interiorCodes.map((c) => [c.code, c.name]));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <Link
            href="/settings/renovation-types"
            className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="size-3.5" /> All budget templates
          </Link>
          <div className="flex items-center gap-2">
            <h2 className="truncate text-lg font-semibold text-navy">{template.name}</h2>
            {!template.active && <Badge variant="outline">Inactive</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">
            {lines.length} budget line{lines.length === 1 ? "" : "s"}
            {" · pricing is set per project, not here"}
          </p>
        </div>
        <AddTemplateLineDialog templateId={templateId} interiorCodes={interiorCodes} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base text-navy">Budget lines</CardTitle>
        </CardHeader>
        <CardContent>
          {lines.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No budget lines yet. Add lines for each cost code in this template.
            </p>
          ) : (
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
                {lines.map((ln) => (
                  <TableRow key={ln.id}>
                    <TableCell className="font-medium text-navy">
                      {codeNameMap.get(ln.costCodeRef) ?? ln.costCodeRef}
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
                      <EditTemplateLineDialog
                        templateId={templateId}
                        line={{
                          id: ln.id,
                          costCodeRef: ln.costCodeRef,
                          pricingMethod: ln.pricingMethod as PricingMethod,
                          unitPrice: ln.unitPrice,
                          defaultQuantity: ln.defaultQuantity,
                          notes: ln.notes,
                        }}
                        interiorCodes={interiorCodes}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-baseline justify-between gap-3">
          <CardTitle className="text-base text-navy">Standard trade scope</CardTitle>
          <span className="text-sm text-muted-foreground">
            The portfolio wording. A property&apos;s renovation type can pull this in and then
            depart from it.
          </span>
        </CardHeader>
        <CardContent className="px-0">
          <TradeScopeSection
            owner={{ level: "template", templateId }}
            entries={scopeEntries}
            copySources={copySources}
          />
        </CardContent>
      </Card>
    </div>
  );
}

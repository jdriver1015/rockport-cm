import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { GitBranchIcon } from "lucide-react";
import { db, schema } from "@/db";
import { PropertyHeader } from "@/components/property-header";
import { PropertyNav } from "@/components/property-nav";
import { BackLink } from "@/components/ui/back-link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  RenovationTypeList,
  type RenovationTypeRow,
  type TemplateOption,
} from "@/components/renovation-type-list";
import { computeInteriorBudgetFor } from "@/lib/interior-budget";
import { num } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function RenovationTypesPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const property = await db().query.properties.findFirst({
    where: eq(schema.properties.slug, slug),
  });
  if (!property) notFound();
  const propertyId = property.id;

  const [groups, lineCounts, templates, budget] = await Promise.all([
    db()
      .select()
      .from(schema.budgetGroups)
      .where(
        and(eq(schema.budgetGroups.propertyId, propertyId), isNull(schema.budgetGroups.archivedAt)),
      )
      .orderBy(asc(schema.budgetGroups.sortOrder), asc(schema.budgetGroups.name)),
    db()
      .select({
        budgetGroupId: schema.budgetGroupLines.budgetGroupId,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.budgetGroupLines)
      .groupBy(schema.budgetGroupLines.budgetGroupId),
    db()
      .select({ id: schema.budgetTemplates.id, name: schema.budgetTemplates.name })
      .from(schema.budgetTemplates)
      .where(and(eq(schema.budgetTemplates.active, true), isNull(schema.budgetTemplates.archivedAt)))
      .orderBy(asc(schema.budgetTemplates.sortOrder), asc(schema.budgetTemplates.name)),
    // Reuse the pivot's own compute so the two views can never disagree on
    // planned units or cost.
    computeInteriorBudgetFor(propertyId),
  ]);

  const linesByGroup = new Map(lineCounts.map((c) => [c.budgetGroupId, c.count]));
  const templateNameById = new Map(templates.map((t) => [t.id, t.name]));

  // Columns are per (floorplan, type); a type's figures are the sum across
  // floorplans, and its per-unit cost is a weighted average because floorplans
  // differ in size.
  const planned = new Map<number, { units: number; cost: number }>();
  for (const c of budget.columns) {
    const acc = planned.get(c.tierId) ?? { units: 0, cost: 0 };
    acc.units += c.plannedUnits;
    acc.cost += c.totalCost;
    planned.set(c.tierId, acc);
  }

  const types: RenovationTypeRow[] = groups.map((g) => {
    const p = planned.get(g.id) ?? { units: 0, cost: 0 };
    return {
      id: g.id,
      name: g.name,
      description: g.description,
      sourceTemplateName:
        g.sourceTemplateId != null ? templateNameById.get(g.sourceTemplateId) ?? null : null,
      lineCount: linesByGroup.get(g.id) ?? 0,
      plannedUnits: p.units,
      totalCost: p.cost,
      avgPerUnit: p.units > 0 ? p.cost / p.units : null,
      targetTradeOut: g.targetTradeOut != null ? num(g.targetTradeOut) : null,
    };
  });

  const templateOptions: TemplateOption[] = templates;

  return (
    <div className="space-y-6">
      <PropertyHeader property={property} />
      <PropertyNav slug={property.slug} />
      <BackLink href={`/properties/${slug}/budget?view=interior`} label="Interior budget" />
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-serif text-2xl font-semibold text-navy">Renovation types</h1>
        {/* Triggers used to hang off the Turn Plan tab's Manage menu. They are
            the rules that decide which type a unit gets, so they belong beside
            the types themselves rather than on the budget. */}
        <Link
          href={`/properties/${slug}/interiors/triggers`}
          className={cn(buttonVariants({ size: "sm", variant: "outline" }))}
        >
          <GitBranchIcon className="size-3.5" />
          Triggers
        </Link>
      </div>
      <RenovationTypeList
        propertyId={propertyId}
        propertySlug={slug}
        types={types}
        templates={templateOptions}
      />
    </div>
  );
}

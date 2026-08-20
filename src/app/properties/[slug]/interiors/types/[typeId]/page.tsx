import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PropertyHeader } from "@/components/property-header";
import { PropertyNav } from "@/components/property-nav";
import { BackLink } from "@/components/ui/back-link";
import { TierBadge } from "@/components/ui/tier-badge";
import {
  RenovationTypePricing,
  type InteriorCodeChoice,
  type PricingLine,
} from "@/components/renovation-type-pricing";
import { computeInteriorBudgetFor } from "@/lib/interior-budget";
import { TradeScopeSection, type CopySource } from "@/components/trade-scope-section";
import { mergeTradeScopes, writtenCount } from "@/lib/trade-scope";
import { listTradeScopeRows } from "@/lib/trade-scope-store";
import { listSpecTables } from "@/lib/spec-tables-store";
import { SpecTablesSection, type SpecCopySource } from "@/components/spec-tables-section";
import { SPEC_KIND_LABELS, SPEC_KINDS, specRowCount } from "@/lib/spec-tables";
import { money, num } from "@/lib/format";
import type { PricingMethod } from "@/lib/pricing";

export const dynamic = "force-dynamic";

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-ink-300">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold tabular-nums text-navy">{value}</div>
      {note && <div className="mt-1 truncate text-[10.5px] text-muted-foreground">{note}</div>}
    </div>
  );
}

export default async function RenovationTypePage({
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

  const [lines, interiorCodes, siblings, template, budget, scopeRows, specTables, scopeCounts] =
    await Promise.all([
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
    // Sibling types drive the switcher, and their order drives the badge colour
    // so a type reads the same hue here as on the budget pivot.
    db()
      .select({ id: schema.budgetGroups.id, name: schema.budgetGroups.name })
      .from(schema.budgetGroups)
      .where(
        and(eq(schema.budgetGroups.propertyId, propertyId), isNull(schema.budgetGroups.archivedAt)),
      )
      .orderBy(asc(schema.budgetGroups.sortOrder), asc(schema.budgetGroups.name)),
    group.sourceTemplateId != null
      ? db().query.budgetTemplates.findFirst({
          where: eq(schema.budgetTemplates.id, group.sourceTemplateId),
          columns: { id: true, name: true },
        })
      : Promise.resolve(undefined),
    computeInteriorBudgetFor(propertyId),
    listTradeScopeRows({ level: "group", budgetGroupId: groupId, propertyId }),
    listSpecTables({ level: "group", budgetGroupId: groupId, propertyId }),
    // Counts for the copy buttons, so a source with nothing written is offered
    // as disabled rather than failing on click.
    db()
      .select({
        budgetGroupId: schema.tradeScopes.budgetGroupId,
        templateId: schema.tradeScopes.templateId,
        count: sql<number>`count(*) filter (where btrim(coalesce(${schema.tradeScopes.body}, '')) <> '')::int`,
      })
      .from(schema.tradeScopes)
      .groupBy(schema.tradeScopes.budgetGroupId, schema.tradeScopes.templateId),
  ]);

  const codeById = new Map(interiorCodes.map((c) => [c.id, c]));

  const pricingLines: PricingLine[] = lines.map((ln) => {
    const code = codeById.get(ln.costCodeId);
    return {
      id: ln.id,
      costCodeId: ln.costCodeId,
      code: code?.code ?? `#${ln.costCodeId}`,
      // A line's own description wins: cost-code names are chart-global, so a
      // per-type pricing basis ("Quartz 2cm $35/sf") only lives on the line.
      label: ln.description ?? code?.name ?? `Code #${ln.costCodeId}`,
      pricingMethod: ln.pricingMethod as PricingMethod,
      unitPrice: num(ln.unitPrice),
      defaultQuantity: ln.defaultQuantity != null ? num(ln.defaultQuantity) : null,
      notes: ln.notes,
    };
  });

  // Planned figures come from the pivot's own compute, summed across floorplans.
  const planned = budget.columns
    .filter((c) => c.tierId === groupId)
    .reduce((acc, c) => ({ units: acc.units + c.plannedUnits, cost: acc.cost + c.totalCost }), {
      units: 0,
      cost: 0,
    });
  const tierIndex = Math.max(
    0,
    siblings.findIndex((s) => s.id === groupId),
  );

  const codeChoices: InteriorCodeChoice[] = interiorCodes;

  const scopeEntries = mergeTradeScopes(scopeRows);
  const scopeSummary = writtenCount(scopeEntries);
  const writtenByGroup = new Map(
    scopeCounts.filter((c) => c.budgetGroupId != null).map((c) => [c.budgetGroupId!, c.count]),
  );
  const writtenByTemplate = new Map(
    scopeCounts.filter((c) => c.templateId != null).map((c) => [c.templateId!, c.count]),
  );
  // Sibling types first, then the portfolio standard this type came from: the
  // nearest wording is usually another type on the same property.
  const copySources: CopySource[] = [
    ...siblings
      .filter((sib) => sib.id !== groupId)
      .map((sib) => ({
        owner: { level: "group" as const, budgetGroupId: sib.id, propertyId },
        label: sib.name,
        writtenCount: writtenByGroup.get(sib.id) ?? 0,
      })),
    ...(template
      ? [
          {
            owner: { level: "template" as const, templateId: template.id },
            label: `${template.name} (standard)`,
            writtenCount: writtenByTemplate.get(template.id) ?? 0,
          },
        ]
      : []),
  ].filter((s) => s.writtenCount > 0);

  // Spec copy sources are offered unconditionally: unlike trade scope there is no
  // cheap per-owner count to gate on here, and the action reports an empty source
  // rather than failing silently.
  const specSources: SpecCopySource[] = [
    ...siblings
      .filter((sib) => sib.id !== groupId)
      .map((sib) => ({
        owner: { level: "group" as const, budgetGroupId: sib.id, propertyId },
        label: sib.name,
        tableCount: 0,
      })),
    ...(template
      ? [
          {
            owner: { level: "template" as const, templateId: template.id },
            label: `${template.name} (standard)`,
            tableCount: 0,
          },
        ]
      : []),
  ];
  const specsByKind = new Map(SPEC_KINDS.map((k) => [k, specTables.filter((t) => t.kind === k)]));

  return (
    <div className="space-y-6">
      <PropertyHeader property={property} />
      <PropertyNav slug={property.slug} />
      <BackLink href={`/properties/${slug}/interiors/types`} label="Renovation types" />

      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <TierBadge label={group.name} index={tierIndex} />
                {template && (
                  <Badge variant="secondary" className="text-[10.5px]">
                    From {template.name}
                  </Badge>
                )}
                {!group.active && <Badge variant="secondary">Inactive</Badge>}
              </div>
              <h1 className="font-serif text-2xl font-semibold text-navy">{group.name}</h1>
              <p className="text-sm text-muted-foreground">
                {group.description ?? "What a unit gets when it is planned into this type."}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/properties/${slug}/interiors/types/${groupId}/bid-sheet`}
                className="rounded-control border border-border px-2.5 py-1 text-xs font-medium text-ink-500 hover:bg-track"
              >
                Bid sheet
              </Link>
            </div>
            {siblings.length > 1 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">Type</span>
                {siblings.map((s) => (
                  <Link
                    key={s.id}
                    href={`/properties/${slug}/interiors/types/${s.id}`}
                    className={
                      s.id === groupId
                        ? "rounded-control bg-navy px-2.5 py-1 text-xs font-semibold text-white"
                        : "rounded-control border border-border px-2.5 py-1 text-xs font-medium text-ink-500 hover:bg-track"
                    }
                  >
                    {s.name}
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4 border-t border-border pt-4 sm:grid-cols-4">
            <Stat label="Priced items" value={String(pricingLines.length)} />
            <Stat
              label="Units planned"
              value={planned.units > 0 ? planned.units.toLocaleString() : "None yet"}
              note={planned.units > 0 ? undefined : "Plan units on the Budget tab"}
              />
            <Stat
              label="Avg / unit"
              value={planned.units > 0 ? money(planned.cost / planned.units) : "—"}
              note={planned.units > 0 ? "Weighted across floorplans" : undefined}
            />
            <Stat
              label="Trade scope"
              value={`${scopeSummary.written} of ${scopeSummary.total}`}
              note={
                group.targetTradeOut != null
                  ? `Target trade-out ${money(num(group.targetTradeOut))}/mo`
                  : "trades written"
              }
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-baseline justify-between gap-3">
          <CardTitle className="text-base text-navy">Default pricing</CardTitle>
          <span className="text-sm text-muted-foreground">
            Every floorplan planned into this type inherits these, except cells with a negotiated
            override.
          </span>
        </CardHeader>
        <CardContent className="px-0">
          <RenovationTypePricing
            propertyId={propertyId}
            budgetGroupId={groupId}
            lines={pricingLines}
            interiorCodes={codeChoices}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-baseline justify-between gap-3">
          <CardTitle className="text-base text-navy">Trade scope</CardTitle>
          <span className="text-sm text-muted-foreground">
            What the contractor is responsible for, trade by trade — the narrative a GC bids from.
          </span>
        </CardHeader>
        <CardContent className="px-0">
          <TradeScopeSection
            owner={{ level: "group", budgetGroupId: groupId, propertyId }}
            entries={scopeEntries}
            copySources={copySources}
          />
        </CardContent>
      </Card>

      {SPEC_KINDS.map((k) => (
        <Card key={k}>
          <CardHeader className="flex flex-row items-baseline justify-between gap-3">
            <CardTitle className="text-base text-navy">{SPEC_KIND_LABELS[k]}</CardTitle>
            <span className="text-sm text-muted-foreground">
              {specRowCount(specsByKind.get(k) ?? [])} specified line(s).
            </span>
          </CardHeader>
          <CardContent className="px-0">
            <SpecTablesSection
              owner={{ level: "group", budgetGroupId: groupId, propertyId }}
              kind={k}
              tables={specsByKind.get(k) ?? []}
              copySources={specSources}
            />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

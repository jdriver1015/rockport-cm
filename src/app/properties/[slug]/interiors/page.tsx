import { Fragment } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { Button } from "@/components/ui/button";
import { PropertyHeader } from "@/components/property-header";
import { PropertyNav } from "@/components/property-nav";
import { ManageBudgetGroupsButton } from "@/components/interior-budget-groups";
import { AmountCell } from "@/components/ui/amount-cell";
import { ClickableTableRow } from "@/components/ui/clickable-table-row";
import { TableCard } from "@/components/ui/table-card";
import { TierBadge } from "@/components/ui/tier-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableGroupRow,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtDate, money, num } from "@/lib/format";
import { PROJECT_PHASES } from "@/lib/stages";
import { projectSlug } from "@/lib/slug";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

function daysBetween(start: string | null, end: string | null): string {
  if (!start || !end) return "—";
  const a = new Date(`${start}T00:00:00`);
  const b = new Date(`${end}T00:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return "—";
  return String(Math.round((b.getTime() - a.getTime()) / 86_400_000));
}

function VarianceCell({ budget, actual }: { budget: number; actual: number }) {
  if (!actual) return <span className="block text-right font-semibold tabular-nums text-ink-100">—</span>;
  const variance = budget - actual;
  const formatted = money(Math.abs(variance));
  if (formatted === "—") return <span className="block text-right font-semibold tabular-nums text-ink-100">—</span>;
  const isPositive = variance >= 0;
  return (
    <span
      className={cn(
        "block text-right font-semibold tabular-nums",
        isPositive ? "text-positive" : "text-red-600",
      )}
    >
      {isPositive ? `+${formatted}` : `-${formatted}`}
    </span>
  );
}

export default async function InteriorsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const property = await db().query.properties.findFirst({
    where: eq(schema.properties.slug, slug),
  });
  if (!property) notFound();
  const propertyId = property.id;

  const [groups, groupLineCounts, templates, interiorProjects, jtdRows] = await Promise.all([
    db()
      .select()
      .from(schema.budgetGroups)
      .where(and(eq(schema.budgetGroups.propertyId, propertyId), isNull(schema.budgetGroups.archivedAt)))
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
      .where(isNull(schema.budgetTemplates.archivedAt))
      .orderBy(asc(schema.budgetTemplates.sortOrder), asc(schema.budgetTemplates.name)),
    db()
      .select({
        id: schema.projects.id,
        name: schema.projects.name,
        phase: schema.projects.phase,
        budgetAmount: schema.projects.budgetAmount,
        budgetGroupId: schema.projects.budgetGroupId,
        startDate: schema.projects.startDate,
        completeDate: schema.projects.completeDate,
        unitNumber: schema.units.unitNumber,
        floorplan: schema.units.floorplan,
      })
      .from(schema.projects)
      .leftJoin(schema.units, eq(schema.projects.unitId, schema.units.id))
      .where(
        and(
          eq(schema.projects.propertyId, propertyId),
          eq(schema.projects.kind, "unit"),
          isNull(schema.projects.archivedAt),
        ),
      )
      .orderBy(desc(schema.projects.createdAt)),
    db()
      .select({
        projectId: schema.glTransactions.projectId,
        total: sql<string>`coalesce(sum(${schema.glTransactions.amount}), 0)`,
      })
      .from(schema.glTransactions)
      .where(
        sql`${schema.glTransactions.propertyId} = ${propertyId} and ${schema.glTransactions.status} = 'posted' and ${schema.glTransactions.projectId} is not null`,
      )
      .groupBy(schema.glTransactions.projectId),
  ]);

  const jtdByProject = new Map(jtdRows.map((r) => [r.projectId, num(r.total)]));

  // Same tier ordering/coloring as the budget pivot — index is the group's
  // position among the property's budget groups, not tied to its name.
  const tierIndexById = new Map(groups.map((g, i) => [g.id, i]));
  const tierNameById = new Map(groups.map((g) => [g.id, g.name]));

  const phaseGroups = PROJECT_PHASES
    .map((ph) => ({
      key: ph.key,
      label: ph.label,
      projects: interiorProjects.filter((p) => p.phase === ph.key),
    }))
    .filter((g) => g.projects.length > 0);

  const linesByGroup = new Map(groupLineCounts.map((c) => [c.budgetGroupId, c.count]));
  const groupsForPanel = groups.map((g) => ({
    id: g.id,
    name: g.name,
    description: g.description,
    sourceTemplateId: g.sourceTemplateId,
    lineCount: linesByGroup.get(g.id) ?? 0,
  }));

  return (
    <div className="space-y-6">
      <PropertyHeader
        property={property}
        action={
          <div className="flex items-center gap-2">
            <ManageBudgetGroupsButton
              propertyId={propertyId}
              propertySlug={slug}
              groups={groupsForPanel}
              templates={templates}
            />
            <Button render={<Link href={`/properties/${slug}/interiors/new`} />} nativeButton={false}>
              New Interior Project
            </Button>
          </div>
        }
      />

      <PropertyNav slug={property.slug} />

      {interiorProjects.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No interior projects yet. Set up your scope groups, then create one from the wizard.
        </p>
      ) : (
        <TableCard>
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[15%]">Project</TableHead>
                <TableHead className="w-[8%]">Floorplan</TableHead>
                <TableHead className="w-[11%]">Upgrade Type</TableHead>
                <TableHead className="w-[10%]">Est. Start</TableHead>
                <TableHead className="w-[10%]">Date Complete</TableHead>
                <TableHead className="w-[6%] text-right">Days</TableHead>
                <TableHead className="w-[13%] text-right">Budgeted Cost</TableHead>
                <TableHead className="w-[15%] text-right">Reconciled Cost</TableHead>
                <TableHead className="w-[12%] text-right">Variance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {phaseGroups.map((g) => (
                <Fragment key={g.key}>
                  <TableGroupRow label={g.label} count={g.projects.length} colSpan={9} />
                  {g.projects.map((p) => {
                    const jtd = jtdByProject.get(p.id) ?? 0;
                    const reconciledCost = jtd;
                    const href = `/properties/${slug}/projects/${projectSlug(p)}`;
                    const tierName = p.budgetGroupId != null ? tierNameById.get(p.budgetGroupId) : undefined;
                    const tierIndex = p.budgetGroupId != null ? tierIndexById.get(p.budgetGroupId) ?? 0 : 0;
                    return (
                      <ClickableTableRow key={p.id} href={href}>
                        <TableCell className="truncate">
                          <Link href={href} className="font-medium text-navy">
                            {p.unitNumber ? `Unit ${p.unitNumber}` : p.name}
                          </Link>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {p.floorplan ?? "—"}
                        </TableCell>
                        <TableCell>
                          {tierName ? (
                            <TierBadge label={tierName} index={tierIndex} />
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="tabular-nums text-muted-foreground">
                          {fmtDate(p.startDate)}
                        </TableCell>
                        <TableCell className="tabular-nums text-muted-foreground">
                          {fmtDate(p.completeDate)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {daysBetween(p.startDate, p.completeDate)}
                        </TableCell>
                        <TableCell>
                          <AmountCell value={p.budgetAmount} />
                        </TableCell>
                        <TableCell>
                          <AmountCell value={reconciledCost} positive={reconciledCost > 0} />
                        </TableCell>
                        <TableCell>
                          <VarianceCell budget={num(p.budgetAmount)} actual={reconciledCost} />
                        </TableCell>
                      </ClickableTableRow>
                    );
                  })}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      )}
    </div>
  );
}

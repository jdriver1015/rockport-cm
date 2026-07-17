import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PropertyHeader } from "@/components/property-header";
import { PropertyNav } from "@/components/property-nav";
import { ManageScopeGroupsButton } from "@/components/interior-scope-groups";
import { num } from "@/lib/format";
import { PROJECT_STAGES } from "@/lib/stages";

export const dynamic = "force-dynamic";

const stageLabel = new Map(PROJECT_STAGES.map((s) => [s.key, s.label]));

export default async function InteriorsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const propertyId = Number(id);
  if (!Number.isInteger(propertyId)) notFound();

  const property = await db().query.properties.findFirst({
    where: eq(schema.properties.id, propertyId),
  });
  if (!property) notFound();

  const [groups, groupItemCounts, templates, interiorProjects] = await Promise.all([
    db()
      .select()
      .from(schema.scopeGroups)
      .where(and(eq(schema.scopeGroups.propertyId, propertyId), isNull(schema.scopeGroups.archivedAt)))
      .orderBy(asc(schema.scopeGroups.sortOrder), asc(schema.scopeGroups.name)),
    db()
      .select({
        scopeGroupId: schema.scopeGroupItems.scopeGroupId,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.scopeGroupItems)
      .groupBy(schema.scopeGroupItems.scopeGroupId),
    db()
      .select({ id: schema.scopeGroupTemplates.id, name: schema.scopeGroupTemplates.name })
      .from(schema.scopeGroupTemplates)
      .where(isNull(schema.scopeGroupTemplates.archivedAt))
      .orderBy(asc(schema.scopeGroupTemplates.sortOrder), asc(schema.scopeGroupTemplates.name)),
    db()
      .select({
        id: schema.projects.id,
        name: schema.projects.name,
        stage: schema.projects.stage,
        budgetAmount: schema.projects.budgetAmount,
        unitNumber: schema.units.unitNumber,
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
  ]);

  const itemsByGroup = new Map(groupItemCounts.map((c) => [c.scopeGroupId, c.count]));
  const groupsForPanel = groups.map((g) => ({
    id: g.id,
    name: g.name,
    description: g.description,
    sourceTemplateId: g.sourceTemplateId,
    itemCount: itemsByGroup.get(g.id) ?? 0,
  }));

  return (
    <div className="space-y-6">
      <PropertyHeader
        property={property}
        action={
          <div className="flex items-center gap-2">
            <ManageScopeGroupsButton propertyId={propertyId} groups={groupsForPanel} templates={templates} />
            <Button render={<Link href={`/properties/${propertyId}/interiors/new`} />} nativeButton={false}>
              New Interior Project
            </Button>
          </div>
        }
      />

      <PropertyNav propertyId={property.id} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base text-navy">Interior renovations</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {interiorProjects.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              No interior projects yet. Set up your scope groups, then create one from the wizard.
            </p>
          ) : (
            <div className="divide-y">
              {interiorProjects.map((p) => (
                <Link
                  key={p.id}
                  href={`/properties/${propertyId}/projects/${p.id}`}
                  className="flex items-center justify-between px-4 py-3 hover:bg-muted/40"
                >
                  <div className="min-w-0">
                    <span className="font-medium text-navy">{p.name}</span>
                    {p.unitNumber && (
                      <span className="ml-2 text-xs text-muted-foreground">Unit {p.unitNumber}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="tabular-nums text-sm text-muted-foreground">
                      ${num(p.budgetAmount).toLocaleString()}
                    </span>
                    <Badge variant="outline">{stageLabel.get(p.stage) ?? p.stage}</Badge>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

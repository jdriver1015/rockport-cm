import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { Button } from "@/components/ui/button";
import { PropertyHeader } from "@/components/property-header";
import { PropertyNav } from "@/components/property-nav";
import { ProjectBoard, type BoardProject } from "@/components/project-board";
import { num } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function PropertyBoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const propertyId = Number(id);
  if (!Number.isInteger(propertyId)) notFound();

  const property = await db().query.properties.findFirst({
    where: eq(schema.properties.id, propertyId),
  });
  if (!property) notFound();

  // Board rows — projects joined to their UW line item + category (division).
  const rows = await db()
    .select({
      id: schema.projects.id,
      name: schema.projects.name,
      kind: schema.projects.kind,
      stage: schema.projects.stage,
      budgetAmount: schema.projects.budgetAmount,
      committedCost: schema.projects.committedCost,
      startDate: schema.projects.startDate,
      completeDate: schema.projects.completeDate,
      costCodeCode: schema.costCodes.code,
      costCodeName: schema.costCodes.name,
      categoryCode: schema.costCategories.code,
      categoryName: schema.costCategories.name,
      division: schema.costCategories.division,
      unitNumber: schema.units.unitNumber,
    })
    .from(schema.projects)
    .leftJoin(schema.costCodes, eq(schema.projects.costCodeId, schema.costCodes.id))
    .leftJoin(schema.costCategories, eq(schema.costCodes.categoryId, schema.costCategories.id))
    .leftJoin(schema.units, eq(schema.projects.unitId, schema.units.id))
    .where(eq(schema.projects.propertyId, propertyId))
    .orderBy(asc(schema.projects.createdAt));

  // JTD actual per project (posted GL only)
  const jtdRows = await db()
    .select({
      projectId: schema.glTransactions.projectId,
      total: sql<string>`coalesce(sum(${schema.glTransactions.amount}), 0)`,
    })
    .from(schema.glTransactions)
    .where(
      sql`${schema.glTransactions.propertyId} = ${propertyId} and ${schema.glTransactions.status} = 'posted' and ${schema.glTransactions.projectId} is not null`,
    )
    .groupBy(schema.glTransactions.projectId);
  const jtdByProject = new Map(jtdRows.map((r) => [r.projectId, num(r.total)]));

  const projects: BoardProject[] = rows.map((r) => {
    const isUnit = r.kind === "unit";
    return {
      id: r.id,
      name: r.name,
      kind: r.kind,
      stage: r.stage,
      budget: num(r.budgetAmount),
      committed: num(r.committedCost),
      jtd: jtdByProject.get(r.id) ?? 0,
      startDate: r.startDate,
      completeDate: r.completeDate,
      // Unit turns spend across the 4000-series → Interiors bucket.
      division: isUnit ? "interiors" : r.division ?? null,
      categoryLabel: isUnit
        ? "Interiors"
        : r.categoryCode
          ? `${r.categoryCode} ${r.categoryName}`
          : "Uncategorized",
      lineItem: isUnit
        ? "4000 Interiors (all codes)"
        : r.costCodeCode
          ? `${r.costCodeCode} · ${r.costCodeName}`
          : "—",
      unitLabel: r.unitNumber ? `Unit ${r.unitNumber}` : null,
    };
  });

  return (
    <div className="space-y-6">
      <PropertyHeader
        property={property}
        action={
          <Button render={<Link href={`/properties/${propertyId}/projects/new`} />} nativeButton={false}>
            New project
          </Button>
        }
      />

      <PropertyNav propertyId={property.id} />

      <ProjectBoard
        projects={projects}
        propertyId={property.id}
        initialView={typeof sp.view === "string" ? sp.view : undefined}
        initialGroup={typeof sp.group === "string" ? sp.group : undefined}
        initialSort={typeof sp.sort === "string" ? sp.sort : undefined}
        initialDir={typeof sp.dir === "string" ? sp.dir : undefined}
        initialKind={typeof sp.kind === "string" ? sp.kind : undefined}
        initialQuery={typeof sp.q === "string" ? sp.q : undefined}
      />
    </div>
  );
}

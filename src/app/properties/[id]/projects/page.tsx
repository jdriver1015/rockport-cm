import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PropertyNav } from "@/components/property-nav";
import { money } from "@/lib/format";
import { stageLabel } from "@/lib/stages";

export const dynamic = "force-dynamic";

export default async function ProjectsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const propertyId = Number(id);
  if (!Number.isInteger(propertyId)) notFound();

  const property = await db().query.properties.findFirst({
    where: eq(schema.properties.id, propertyId),
  });
  if (!property) notFound();

  const projects = await db()
    .select({
      project: schema.projects,
      costCode: schema.costCodes,
    })
    .from(schema.projects)
    .leftJoin(schema.costCodes, eq(schema.projects.costCodeId, schema.costCodes.id))
    .where(eq(schema.projects.propertyId, propertyId))
    .orderBy(asc(schema.projects.createdAt));

  const common = projects.filter((p) => p.project.kind === "common");
  const unitProjects = projects.filter((p) => p.project.kind === "unit");

  const section = (title: string, rows: typeof projects) => (
    <Card>
      <CardContent className="pt-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {title} ({rows.length})
        </h2>
        {rows.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">None yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead>UW line item</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead className="text-right">Budget</TableHead>
                <TableHead className="text-right">Committed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ project, costCode }) => (
                <TableRow key={project.id}>
                  <TableCell>
                    <Link
                      href={`/properties/${propertyId}/projects/${project.id}`}
                      className="font-medium text-gold-link hover:underline"
                    >
                      {project.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {costCode ? (
                      <span className="font-mono text-xs">
                        {costCode.code} · {costCode.name}
                      </span>
                    ) : (
                      <span className="text-xs">4000 Interiors (all codes)</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{stageLabel(project.stage)}</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(project.budgetAmount)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(project.committedCost)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-semibold text-navy">{property.name}</h1>
          <p className="text-sm text-muted-foreground">Work projects and their stage</p>
        </div>
        <Button
          render={<Link href={`/properties/${propertyId}/projects/new`} />}
          nativeButton={false}
        >
          New project
        </Button>
      </div>

      <PropertyNav propertyId={property.id} />

      {section("Common area & amenity projects", common)}
      {section("Interior unit projects", unitProjects)}
    </div>
  );
}

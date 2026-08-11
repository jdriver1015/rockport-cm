import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ClickableTableRow } from "@/components/ui/clickable-table-row";
import { PropertyHeader } from "@/components/property-header";
import { RestoreProjectButton } from "@/components/restore-project-button";
import { fmtDate } from "@/lib/format";
import { phaseLabel } from "@/lib/stages";
import { projectSlug } from "@/lib/slug";

export const dynamic = "force-dynamic";

export default async function ArchivedProjectsPage({
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

  const archived = await db()
    .select()
    .from(schema.projects)
    .where(
      and(
        eq(schema.projects.propertyId, propertyId),
        eq(schema.projects.kind, "common"),
        isNotNull(schema.projects.archivedAt),
      ),
    )
    .orderBy(desc(schema.projects.archivedAt));

  return (
    <div className="space-y-6">
      <PropertyHeader property={property} />

      <div>
        <p className="text-sm">
          <Link href={`/properties/${slug}`} className="text-link hover:underline">
            ← All projects
          </Link>
        </p>
        <h1 className="mt-1 font-serif text-2xl font-semibold text-navy">Archived projects</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base text-navy">
            {archived.length} archived project{archived.length === 1 ? "" : "s"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {archived.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No archived projects.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Stage at archive</TableHead>
                    <TableHead>Archived</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {archived.map((p) => (
                    <ClickableTableRow key={p.id} href={`/properties/${slug}/projects/${projectSlug(p)}`}>
                      <TableCell>
                        <Link
                          href={`/properties/${slug}/projects/${projectSlug(p)}`}
                          className="font-medium text-navy"
                        >
                          {p.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {phaseLabel(p.phase)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {p.archivedAt ? fmtDate(p.archivedAt) : "—"}
                      </TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <RestoreProjectButton projectId={p.id} />
                      </TableCell>
                    </ClickableTableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

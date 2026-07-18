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
import { PropertyHeader } from "@/components/property-header";
import { RestoreProjectButton } from "@/components/restore-project-button";
import { fmtDate } from "@/lib/format";
import { stageLabel } from "@/lib/stages";

export const dynamic = "force-dynamic";

export default async function ArchivedProjectsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const propertyId = Number(id);
  if (!Number.isInteger(propertyId)) notFound();

  const property = await db().query.properties.findFirst({
    where: eq(schema.properties.id, propertyId),
  });
  if (!property) notFound();

  const archived = await db()
    .select()
    .from(schema.projects)
    .where(and(eq(schema.projects.propertyId, propertyId), isNotNull(schema.projects.archivedAt)))
    .orderBy(desc(schema.projects.archivedAt));

  return (
    <div className="space-y-6">
      <PropertyHeader property={property} />

      <div>
        <p className="text-sm">
          <Link href={`/properties/${propertyId}`} className="text-gold-link hover:underline">
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
                    <TableRow key={p.id}>
                      <TableCell>
                        <Link
                          href={`/properties/${propertyId}/projects/${p.id}`}
                          className="font-medium text-navy hover:underline"
                        >
                          {p.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {stageLabel(p.stage)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {p.archivedAt ? fmtDate(p.archivedAt) : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <RestoreProjectButton projectId={p.id} />
                      </TableCell>
                    </TableRow>
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

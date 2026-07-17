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
import { RestoreBatchButton } from "@/components/restore-batch-button";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ArchivedBatchesPage({
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
    .from(schema.importBatches)
    .where(
      and(
        eq(schema.importBatches.propertyId, propertyId),
        isNotNull(schema.importBatches.archivedAt),
      ),
    )
    .orderBy(desc(schema.importBatches.archivedAt));

  return (
    <div className="space-y-6">
      <PropertyHeader property={property} />

      <div>
        <p className="text-sm">
          <Link href={`/properties/${propertyId}/gl`} className="text-gold-link hover:underline">
            ← Import history
          </Link>
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-navy">Archived imports</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base text-navy">
            {archived.length} archived import{archived.length === 1 ? "" : "s"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {archived.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No archived imports.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>File</TableHead>
                    <TableHead>Rows</TableHead>
                    <TableHead>Archived</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {archived.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell>
                        <Link
                          href={`/properties/${propertyId}/gl/${b.id}`}
                          className="font-medium text-navy hover:underline"
                        >
                          {b.fileName}
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{b.rowCount}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {b.archivedAt ? fmtDate(b.archivedAt) : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <RestoreBatchButton batchId={b.id} />
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

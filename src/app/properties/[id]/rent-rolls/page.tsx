import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AddRentRollDialog } from "@/components/add-rent-roll-dialog";
import { RentRollBatchRow } from "@/components/rent-roll-batch-row";
import { PropertyHeader } from "@/components/property-header";
import { PropertyNav } from "@/components/property-nav";

export const dynamic = "force-dynamic";

export default async function RentRollsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const propertyId = Number(id);
  if (!Number.isInteger(propertyId)) notFound();

  const [property, batches, [archivedCount]] = await Promise.all([
    db().query.properties.findFirst({ where: eq(schema.properties.id, propertyId) }),
    db()
      .select()
      .from(schema.rentRollBatches)
      .where(
        and(
          eq(schema.rentRollBatches.propertyId, propertyId),
          isNull(schema.rentRollBatches.archivedAt),
        ),
      )
      .orderBy(desc(schema.rentRollBatches.asOfDate), desc(schema.rentRollBatches.createdAt)),
    db()
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.rentRollBatches)
      .where(
        and(
          eq(schema.rentRollBatches.propertyId, propertyId),
          isNotNull(schema.rentRollBatches.archivedAt),
        ),
      ),
  ]);
  if (!property) notFound();

  return (
    <div className="space-y-6">
      <PropertyHeader property={property} />

      <PropertyNav propertyId={property.id} />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base text-navy">Rent roll snapshots</CardTitle>
          <div className="flex items-center gap-3">
            {archivedCount.count > 0 && (
              <Link
                href={`/properties/${propertyId}/rent-rolls/archived`}
                className="text-sm text-gold-link hover:underline"
              >
                Archived ({archivedCount.count})
              </Link>
            )}
            <AddRentRollDialog propertyId={property.id} />
          </div>
        </CardHeader>
        <CardContent>
          {batches.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No rent rolls yet. Click <span className="font-medium">Add rent roll</span> to upload
              your first snapshot (Excel, CSV, or PDF).
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>File</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>As of</TableHead>
                    <TableHead>Uploaded</TableHead>
                    <TableHead className="text-right">Units</TableHead>
                    <TableHead className="text-right">Occupancy</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {batches.map((b) => (
                    <RentRollBatchRow key={b.id} propertyId={property.id} batch={b} />
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

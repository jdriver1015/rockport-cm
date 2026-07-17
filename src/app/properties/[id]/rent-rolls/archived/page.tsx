import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RentRollBatchRow } from "@/components/rent-roll-batch-row";
import { PropertyNav } from "@/components/property-nav";

export const dynamic = "force-dynamic";

export default async function ArchivedRentRollsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const propertyId = Number(id);
  if (!Number.isInteger(propertyId)) notFound();

  const [property, batches] = await Promise.all([
    db().query.properties.findFirst({ where: eq(schema.properties.id, propertyId) }),
    db()
      .select()
      .from(schema.rentRollBatches)
      .where(
        and(
          eq(schema.rentRollBatches.propertyId, propertyId),
          isNotNull(schema.rentRollBatches.archivedAt),
        ),
      )
      .orderBy(desc(schema.rentRollBatches.createdAt)),
  ]);
  if (!property) notFound();

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm">
          <Link
            href={`/properties/${propertyId}/rent-rolls`}
            className="text-gold-link hover:underline"
          >
            ← Rent roll snapshots
          </Link>
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-navy">Archived rent rolls</h1>
      </div>

      <PropertyNav propertyId={property.id} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base text-navy">Archived</CardTitle>
        </CardHeader>
        <CardContent>
          {batches.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nothing archived. Deleted rent rolls appear here and can be restored.
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

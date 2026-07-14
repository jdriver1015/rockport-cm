import { notFound } from "next/navigation";
import { asc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PropertyNav } from "@/components/property-nav";
import { VendorsView, type VendorRow } from "@/components/vendors-view";
import { AddVendorDialog } from "@/components/add-vendor-dialog";

export const dynamic = "force-dynamic";

export default async function VendorsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const propertyId = Number(id);
  if (!Number.isInteger(propertyId)) notFound();

  const property = await db().query.properties.findFirst({
    where: eq(schema.properties.id, propertyId),
  });
  if (!property) notFound();

  // Roster is portfolio-wide; bid/win counts are scoped to this property.
  const vendors = await db().select().from(schema.vendors).orderBy(asc(schema.vendors.name));

  const contacts = await db()
    .select()
    .from(schema.vendorContacts)
    .orderBy(asc(schema.vendorContacts.name));

  const bidCounts = await db()
    .select({
      vendorId: schema.bids.vendorId,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.bids)
    .innerJoin(schema.projects, eq(schema.bids.projectId, schema.projects.id))
    .where(eq(schema.projects.propertyId, propertyId))
    .groupBy(schema.bids.vendorId);
  const bidsByVendor = new Map(bidCounts.map((r) => [r.vendorId, r.count]));

  const wonCounts = await db()
    .select({
      vendorId: schema.projects.vendorId,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.projects)
    .where(
      sql`${schema.projects.propertyId} = ${propertyId} and ${schema.projects.vendorId} is not null`,
    )
    .groupBy(schema.projects.vendorId);
  const wonByVendor = new Map(wonCounts.map((r) => [r.vendorId, r.count]));

  const rows: VendorRow[] = vendors.map((v) => ({
    id: v.id,
    name: v.name,
    trade: v.trade,
    active: v.active,
    notes: v.notes,
    contacts: contacts
      .filter((c) => c.vendorId === v.id)
      .map((c) => ({
        id: c.id,
        name: c.name,
        title: c.title,
        email: c.email,
        phone: c.phone,
        isPrimary: c.isPrimary,
        active: c.active,
      })),
    bidCount: bidsByVendor.get(v.id) ?? 0,
    wonCount: wonByVendor.get(v.id) ?? 0,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-semibold text-navy">{property.name}</h1>
      </div>

      <PropertyNav propertyId={property.id} />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base text-navy">Vendors</CardTitle>
          <AddVendorDialog propertyId={property.id} />
        </CardHeader>
        <CardContent>
          <VendorsView propertyId={property.id} vendors={rows} />
        </CardContent>
      </Card>
    </div>
  );
}

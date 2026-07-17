import { and, asc, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { VendorsView, type VendorRow } from "@/components/vendors-view";
import { AddVendorDialog } from "@/components/add-vendor-dialog";

export const dynamic = "force-dynamic";

export default async function VendorsPage() {
  const [vendors, contacts, bidCounts, wonCounts] = await Promise.all([
    db().select().from(schema.vendors).orderBy(asc(schema.vendors.name)),
    db().select().from(schema.vendorContacts).orderBy(asc(schema.vendorContacts.name)),
    db()
      .select({ vendorId: schema.bids.vendorId, count: sql<number>`count(*)::int` })
      .from(schema.bids)
      .where(isNull(schema.bids.archivedAt))
      .groupBy(schema.bids.vendorId),
    db()
      .select({ vendorId: schema.projects.vendorId, count: sql<number>`count(*)::int` })
      .from(schema.projects)
      .where(and(sql`${schema.projects.vendorId} is not null`, isNull(schema.projects.archivedAt)))
      .groupBy(schema.projects.vendorId),
  ]);
  const bidsByVendor = new Map(bidCounts.map((r) => [r.vendorId, r.count]));
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
        <h1 className="text-2xl font-bold tracking-tight text-navy">Vendors</h1>
        <p className="text-sm text-muted-foreground">Portfolio-wide roster — shared across every property</p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base text-navy">Vendors</CardTitle>
          <AddVendorDialog />
        </CardHeader>
        <CardContent>
          <VendorsView vendors={rows} />
        </CardContent>
      </Card>
    </div>
  );
}

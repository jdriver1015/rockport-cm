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
import { RestoreAuditButton } from "@/components/restore-audit-button";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ArchivedAuditsPage({
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
    .from(schema.siteAudits)
    .where(and(eq(schema.siteAudits.propertyId, propertyId), isNotNull(schema.siteAudits.archivedAt)))
    .orderBy(desc(schema.siteAudits.archivedAt));

  return (
    <div className="space-y-6">
      <PropertyHeader property={property} />

      <div>
        <p className="text-sm">
          <Link href={`/properties/${propertyId}/audits`} className="text-gold-link hover:underline">
            ← Site Audits
          </Link>
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-navy">Archived audits</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base text-navy">
            {archived.length} archived audit{archived.length === 1 ? "" : "s"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {archived.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No archived audits.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Archived</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {archived.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell>
                        <Link
                          href={`/properties/${propertyId}/audits/${a.id}`}
                          className="font-medium text-navy hover:underline"
                        >
                          {a.title}
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {fmtDate(a.auditDate)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {a.archivedAt ? fmtDate(a.archivedAt) : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <RestoreAuditButton propertyId={propertyId} auditId={a.id} />
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

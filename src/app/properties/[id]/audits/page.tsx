import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { Badge } from "@/components/ui/badge";
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
import { PropertyNav } from "@/components/property-nav";
import { AddAuditDialog } from "@/components/add-audit-dialog";
import { createClient } from "@/lib/supabase/server";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AuditsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const propertyId = Number(id);
  if (!Number.isInteger(propertyId)) notFound();

  const property = await db().query.properties.findFirst({
    where: eq(schema.properties.id, propertyId),
  });
  if (!property) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const profile = user
    ? await db().query.profiles.findFirst({ where: eq(schema.profiles.id, user.id) })
    : null;

  const [audits, findingCounts, archivedCount] = await Promise.all([
    db()
      .select()
      .from(schema.siteAudits)
      .where(and(eq(schema.siteAudits.propertyId, propertyId), isNull(schema.siteAudits.archivedAt)))
      .orderBy(desc(schema.siteAudits.auditDate), desc(schema.siteAudits.id)),
    db()
      .select({
        auditId: schema.auditFindings.auditId,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.auditFindings)
      .where(isNull(schema.auditFindings.archivedAt))
      .groupBy(schema.auditFindings.auditId),
    db().$count(
      schema.siteAudits,
      and(eq(schema.siteAudits.propertyId, propertyId), isNotNull(schema.siteAudits.archivedAt)),
    ),
  ]);

  const findingsByAudit = new Map(findingCounts.map((r) => [r.auditId, r.count]));

  return (
    <div className="space-y-6">
      <PropertyHeader property={property} />

      <PropertyNav propertyId={property.id} />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base text-navy">Site Audits</CardTitle>
          <div className="flex items-center gap-3">
            {archivedCount > 0 && (
              <Link
                href={`/properties/${propertyId}/audits/archived`}
                className="text-sm text-gold-link hover:underline"
              >
                Archived ({archivedCount})
              </Link>
            )}
            <AddAuditDialog propertyId={property.id} defaultAuditor={profile?.fullName ?? null} />
          </div>
        </CardHeader>
        <CardContent>
          {audits.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No audits yet. Click <span className="font-medium">New audit</span> to start a
              walk-through.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Auditor</TableHead>
                    <TableHead className="text-right">Findings</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {audits.map((a) => (
                    <TableRow key={a.id} className="cursor-pointer">
                      <TableCell className="font-medium text-navy">
                        <Link
                          href={`/properties/${propertyId}/audits/${a.id}`}
                          className="hover:underline"
                        >
                          {a.title}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{fmtDate(a.auditDate)}</TableCell>
                      <TableCell className="text-muted-foreground">{a.auditorName ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {findingsByAudit.get(a.id) ?? 0}
                      </TableCell>
                      <TableCell>
                        <Badge variant={a.status === "complete" ? "positive" : "pending"}>
                          {a.status}
                        </Badge>
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

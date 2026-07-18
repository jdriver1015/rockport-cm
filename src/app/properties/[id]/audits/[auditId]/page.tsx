import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AuditFindings, type FindingRow } from "@/components/audit-findings";
import { AuditHeaderActions } from "@/components/audit-header-actions";
import type { PhotoRow } from "@/components/audit-photo-gallery";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AuditDetailPage({
  params,
}: {
  params: Promise<{ id: string; auditId: string }>;
}) {
  const { id, auditId: aid } = await params;
  const propertyId = Number(id);
  const auditId = Number(aid);
  if (!Number.isInteger(propertyId) || !Number.isInteger(auditId)) notFound();

  const audit = await db().query.siteAudits.findFirst({
    where: eq(schema.siteAudits.id, auditId),
  });
  if (!audit || audit.propertyId !== propertyId) notFound();

  const findings = await db()
    .select()
    .from(schema.auditFindings)
    .where(and(eq(schema.auditFindings.auditId, auditId), isNull(schema.auditFindings.archivedAt)))
    .orderBy(asc(schema.auditFindings.sortIndex), asc(schema.auditFindings.id));

  const findingRows: FindingRow[] = findings.map((f) => ({
    id: f.id,
    title: f.title,
    description: f.description,
    location: f.location,
    severity: f.severity,
    status: f.status,
    assignee: f.assignee,
    dueDate: f.dueDate,
  }));

  const findingIds = findings.map((f) => f.id);
  const photos = findingIds.length
    ? await db()
        .select()
        .from(schema.auditPhotos)
        .where(
          and(
            inArray(schema.auditPhotos.findingId, findingIds),
            isNull(schema.auditPhotos.archivedAt),
          ),
        )
        .orderBy(asc(schema.auditPhotos.sortIndex), asc(schema.auditPhotos.id))
    : [];

  const photosByFinding: Record<number, PhotoRow[]> = {};
  for (const p of photos) {
    const stampParts = [
      p.takenAt ? fmtDate(p.takenAt) : null,
      p.gpsLat != null && p.gpsLng != null ? `${p.gpsLat}, ${p.gpsLng}` : null,
    ].filter(Boolean);
    (photosByFinding[p.findingId] ??= []).push({
      id: p.id,
      caption: p.caption,
      hasAnnotation: p.annotatedPath != null,
      stamp: stampParts.length ? stampParts.join(" · ") : null,
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm">
          <Link href={`/properties/${propertyId}/audits`} className="text-gold-link hover:underline">
            ← Site Audits
          </Link>
        </p>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-serif text-2xl font-semibold text-navy">{audit.title}</h1>
              <Badge variant={audit.status === "complete" ? "positive" : "pending"}>
                {audit.status}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {fmtDate(audit.auditDate)}
              {audit.auditorName ? ` · ${audit.auditorName}` : ""}
            </p>
            {audit.notes && <p className="mt-1 text-sm text-muted-foreground">{audit.notes}</p>}
          </div>
          <AuditHeaderActions
            propertyId={propertyId}
            audit={{
              id: audit.id,
              title: audit.title,
              auditDate: audit.auditDate,
              auditorName: audit.auditorName,
              notes: audit.notes,
              status: audit.status,
            }}
          />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base text-navy">Findings</CardTitle>
        </CardHeader>
        <CardContent>
          <AuditFindings
            propertyId={propertyId}
            auditId={auditId}
            findings={findingRows}
            photosByFinding={photosByFinding}
            readOnly={audit.status === "complete"}
          />
        </CardContent>
      </Card>
    </div>
  );
}

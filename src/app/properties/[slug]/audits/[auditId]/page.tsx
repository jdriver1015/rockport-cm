import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AuditFindings, type FindingRow } from "@/components/audit-findings";
import { AuditHeaderActions } from "@/components/audit-header-actions";
import { WalkPhotoCapture, type WalkPhoto } from "@/components/walk-photo-capture";
import { WalkSummary } from "@/components/walk-summary";
import type { PhotoRow } from "@/components/audit-photo-gallery";
import { fmtDate, fmtTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AuditDetailPage({
  params,
}: {
  params: Promise<{ slug: string; auditId: string }>;
}) {
  const { slug, auditId: aid } = await params;
  const auditId = Number(aid);
  if (!Number.isInteger(auditId)) notFound();

  const property = await db().query.properties.findFirst({ where: eq(schema.properties.slug, slug) });
  if (!property) notFound();
  const propertyId = property.id;

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

  // Every photo on the walk, including the ones attached to no finding. It
  // used to select by finding id, which could not see a walk-level photo at
  // all — and those are now the common case, since the camera no longer
  // requires a defect to be written up first.
  const photos = await db()
    .select()
    .from(schema.auditPhotos)
    .where(
      and(eq(schema.auditPhotos.auditId, auditId), isNull(schema.auditPhotos.archivedAt)),
    )
    .orderBy(asc(schema.auditPhotos.sortIndex), asc(schema.auditPhotos.id));

  // A Map, not a Record: walk-level photos key on null, which an object index
  // signature cannot express.
  const photosByFinding = new Map<number | null, PhotoRow[]>();
  for (const p of photos) {
    const stampParts = [
      p.takenAt ? fmtDate(p.takenAt) : null,
      p.gpsLat != null && p.gpsLng != null ? `${p.gpsLat}, ${p.gpsLng}` : null,
    ].filter(Boolean);
    const bucket = photosByFinding.get(p.findingId) ?? [];
    photosByFinding.set(p.findingId, bucket);
    bucket.push({
      id: p.id,
      caption: p.caption,
      hasAnnotation: p.annotatedPath != null,
      // Cache-bust: annotatedPath gets a fresh UUID on every re-annotation, so
      // using it as a version tag forces the <img> to refetch instead of
      // reusing the previous render.
      version: p.annotatedPath ?? p.storagePath,
      stamp: stampParts.length ? stampParts.join(" · ") : null,
    });
  }

  const walkPhotos: WalkPhoto[] = photos.map((p) => ({
    id: p.id,
    caption: p.caption,
    hasAnnotation: p.annotatedPath != null,
    version: p.annotatedPath ?? p.storagePath,
    findingId: p.findingId,
  }));
  const readOnly = audit.status === "complete";

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm">
          <Link href={`/properties/${slug}/audits`} className="text-link hover:underline">
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
              {audit.walkTime ? ` · ${fmtTime(audit.walkTime)}` : ""}
              {audit.auditorName ? ` · ${audit.auditorName}` : ""}
            </p>
          </div>
          <AuditHeaderActions
            propertyId={propertyId}
            propertySlug={slug}
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

      {/* Photos, then the narrative, then issues — the order the walk actually
          happens in. Issues are the exception, not the entry point. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base text-navy">Photos</CardTitle>
        </CardHeader>
        <CardContent>
          <WalkPhotoCapture
            propertyId={propertyId}
            auditId={auditId}
            photos={walkPhotos}
            canEdit={!readOnly}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base text-navy">Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <WalkSummary
            auditId={auditId}
            propertyId={propertyId}
            initialNotes={audit.notes}
            canEdit={!readOnly}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base text-navy">Issues</CardTitle>
        </CardHeader>
        <CardContent>
          <AuditFindings
            propertyId={propertyId}
            auditId={auditId}
            findings={findingRows}
            photosByFinding={photosByFinding}
            readOnly={readOnly}
          />
        </CardContent>
      </Card>
    </div>
  );
}

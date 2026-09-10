import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AuditFindings, type FindingRow } from "@/components/audit-findings";
import { AuditHeaderActions } from "@/components/audit-header-actions";
import { WalkPhotoCapture, type WalkPhoto } from "@/components/walk-photo-capture";
import { WalkSummary } from "@/components/walk-summary";
import { WalkAttendees } from "@/components/walk-attendees";
import {
  readAttendeeRoster,
  readWalkAttendees,
  type WalkAttendee,
} from "@/lib/walk-attendee-roster";
import type { PhotoRow } from "@/components/audit-photo-gallery";
import { fmtDate, fmtTime } from "@/lib/format";
import { managerInitials } from "@/lib/project-managers";

export const dynamic = "force-dynamic";

const STACK_LIMIT = 4;

/**
 * Who is walking, at a glance.
 *
 * A summary, not a control: the card below is where people are added, invited
 * and removed. This exists so that opening a walk on a phone answers "who else
 * is meant to be here" without scrolling past the photos.
 */
function AttendeeStack({ attendees }: { attendees: WalkAttendee[] }) {
  if (attendees.length === 0) return null;
  const shown = attendees.slice(0, STACK_LIMIT);
  const rest = attendees.length - shown.length;

  return (
    <div className="mt-2 flex items-center gap-2">
      {/* Overlapped, with a ring in the page background so the edges read as
          separate discs rather than one blur. */}
      <div className="flex -space-x-1.5">
        {shown.map((a) => (
          <span
            key={a.id}
            title={a.name}
            className="grid size-6 place-items-center rounded-full bg-track text-[9px] font-bold text-ink-500 ring-2 ring-background"
          >
            {managerInitials(a.name)}
          </span>
        ))}
      </div>
      <span className="text-xs text-muted-foreground">
        {/* The names themselves once there is room; a count when there is not. */}
        <span className="hidden sm:inline">
          {shown.map((a) => a.name).join(", ")}
          {rest > 0 ? ` +${rest} more` : ""}
        </span>
        <span className="sm:hidden">
          {attendees.length} on this walk
        </span>
      </span>
    </div>
  );
}

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

  const [attendees, roster] = await Promise.all([
    readWalkAttendees(auditId),
    readAttendeeRoster(),
  ]);

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
      {/* Quiet header. Draft is the state a walk is in for all of the time it
          is being worked, so a yellow badge saying so was decoration that
          never changed — only finishing one is worth marking. */}
      <div>
        <p className="text-sm">
          <Link href={`/properties/${slug}/audits`} className="text-link hover:underline">
            ← Site Walks
          </Link>
        </p>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
          <div className="min-w-0">
            <h1 className="font-serif text-2xl font-semibold text-navy">{audit.title}</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {fmtDate(audit.auditDate)}
              {audit.walkTime ? ` · ${fmtTime(audit.walkTime)}` : ""}
              {audit.auditorName ? ` · ${audit.auditorName}` : ""}
              {readOnly ? (
                <span className="ml-2 font-medium text-positive">· Complete</span>
              ) : null}
            </p>
            <AttendeeStack attendees={attendees} />
          </div>
          <AuditHeaderActions
            propertyId={propertyId}
            propertySlug={slug}
            audit={{
              id: audit.id,
              title: audit.title,
              auditDate: audit.auditDate,
              walkTime: audit.walkTime,
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
          <CardTitle className="text-base text-navy">Who&rsquo;s on this walk</CardTitle>
        </CardHeader>
        <CardContent>
          <WalkAttendees
            auditId={auditId}
            attendees={attendees}
            roster={roster}
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

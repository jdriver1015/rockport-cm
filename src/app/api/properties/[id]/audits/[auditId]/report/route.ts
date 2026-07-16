import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { createClient } from "@/lib/supabase/server";
import { ATTACHMENTS_BUCKET, createAdminClient } from "@/lib/supabase/admin";
import { AuditReport, type ReportFinding } from "@/lib/audit-report";
import { fmtDate } from "@/lib/format";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; auditId: string }> },
) {
  const { id, auditId: aid } = await ctx.params;
  const propertyId = Number(id);
  const auditId = Number(aid);
  if (!Number.isInteger(propertyId) || !Number.isInteger(auditId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const audit = await db().query.siteAudits.findFirst({
    where: eq(schema.siteAudits.id, auditId),
  });
  if (!audit || audit.propertyId !== propertyId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const property = await db().query.properties.findFirst({
    where: eq(schema.properties.id, propertyId),
  });
  if (!property) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const findings = await db()
    .select()
    .from(schema.auditFindings)
    .where(and(eq(schema.auditFindings.auditId, auditId), isNull(schema.auditFindings.archivedAt)))
    .orderBy(asc(schema.auditFindings.sortIndex), asc(schema.auditFindings.id));

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

  // Sign each photo (annotated render when present) so react-pdf can fetch it.
  const admin = createAdminClient();
  const photoByFinding = new Map<number, (typeof photos)[number][]>();
  for (const p of photos) {
    const arr = photoByFinding.get(p.findingId) ?? [];
    arr.push(p);
    photoByFinding.set(p.findingId, arr);
  }

  async function signed(path: string): Promise<string | null> {
    const { data } = await admin.storage.from(ATTACHMENTS_BUCKET).createSignedUrl(path, 300);
    return data?.signedUrl ?? null;
  }

  const reportFindings: ReportFinding[] = [];
  for (let i = 0; i < findings.length; i++) {
    const f = findings[i];
    const fPhotos = photoByFinding.get(f.id) ?? [];
    const reportPhotos = [];
    for (const p of fPhotos) {
      const url = await signed(p.annotatedPath ?? p.storagePath);
      if (!url) continue;
      const stampParts = [
        p.takenAt ? fmtDate(p.takenAt) : null,
        p.gpsLat != null && p.gpsLng != null ? `${p.gpsLat}, ${p.gpsLng}` : null,
      ].filter(Boolean) as string[];
      reportPhotos.push({ url, caption: p.caption, stamp: stampParts.join(" · ") || null });
    }
    reportFindings.push({
      index: i + 1,
      title: f.title,
      description: f.description,
      location: f.location,
      severity: f.severity,
      status: f.status,
      assignee: f.assignee,
      dueDate: f.dueDate ? fmtDate(f.dueDate) : null,
      photos: reportPhotos,
    });
  }

  const buffer = await renderToBuffer(
    AuditReport({
      data: {
        propertyName: property.name,
        auditTitle: audit.title,
        auditDate: fmtDate(audit.auditDate),
        auditorName: audit.auditorName,
        status: audit.status,
        notes: audit.notes,
        findings: reportFindings,
      },
    }),
  );

  const filename = `${property.name} - ${audit.title}.pdf`.replace(/[^a-zA-Z0-9 .\-_]/g, "_");
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
    },
  });
}

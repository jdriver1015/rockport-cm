import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { createClient } from "@/lib/supabase/server";
import { ATTACHMENTS_BUCKET, createAdminClient } from "@/lib/supabase/admin";

/**
 * Redirect to a short-lived signed URL for an audit photo. `?v=annotated`
 * serves the flattened annotated render when one exists.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; auditId: string; photoId: string }> },
) {
  const { id, auditId: aid, photoId: pid } = await ctx.params;
  const propertyId = Number(id);
  const auditId = Number(aid);
  const photoId = Number(pid);
  if (!Number.isInteger(propertyId) || !Number.isInteger(auditId) || !Number.isInteger(photoId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const photo = await db().query.auditPhotos.findFirst({
    where: eq(schema.auditPhotos.id, photoId),
  });
  if (!photo || photo.findingId == null) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // Confirm the photo belongs to a finding in this audit / property.
  const finding = await db().query.auditFindings.findFirst({
    where: eq(schema.auditFindings.id, photo.findingId),
  });
  if (!finding || finding.auditId !== auditId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const audit = await db().query.siteAudits.findFirst({ where: eq(schema.siteAudits.id, auditId) });
  if (!audit || audit.propertyId !== propertyId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const wantAnnotated = req.nextUrl.searchParams.get("v") === "annotated";
  const path = wantAnnotated && photo.annotatedPath ? photo.annotatedPath : photo.storagePath;

  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(ATTACHMENTS_BUCKET).createSignedUrl(path, 60);
  if (error || !data) {
    return NextResponse.json({ error: "Could not create link" }, { status: 500 });
  }

  // Proxy mode streams the bytes through this same-origin route so the annotator
  // can draw the image to a canvas and export it without tainting the canvas.
  if (req.nextUrl.searchParams.get("proxy") === "1") {
    const upstream = await fetch(data.signedUrl);
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json({ error: "Could not fetch image" }, { status: 502 });
    }
    return new NextResponse(upstream.body, {
      headers: {
        "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream",
        "Cache-Control": "private, max-age=60",
      },
    });
  }

  return NextResponse.redirect(data.signedUrl);
}

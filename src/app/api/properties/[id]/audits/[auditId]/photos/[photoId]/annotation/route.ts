import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { createClient } from "@/lib/supabase/server";
import { ATTACHMENTS_BUCKET, AUDIT_PHOTOS_PREFIX, createAdminClient } from "@/lib/supabase/admin";

/**
 * Save a photo annotation: stores the re-editable vector overlay (jsonb) and a
 * flattened PNG render used for display and the PDF report.
 */
export async function POST(
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
  if (!photo) return NextResponse.json({ error: "Not found" }, { status: 404 });
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

  const formData = await req.formData();
  const file = formData.get("file");
  const annotationRaw = formData.get("annotation");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No render provided" }, { status: 400 });
  }
  let annotation: unknown = null;
  if (typeof annotationRaw === "string" && annotationRaw) {
    try {
      annotation = JSON.parse(annotationRaw);
    } catch {
      return NextResponse.json({ error: "Bad annotation data" }, { status: 400 });
    }
  }

  const admin = createAdminClient();
  const path = `${AUDIT_PHOTOS_PREFIX}/${auditId}/${photo.findingId}/annotated-${crypto.randomUUID()}.png`;
  const { error: uploadErr } = await admin.storage
    .from(ATTACHMENTS_BUCKET)
    .upload(path, file, { contentType: "image/png", upsert: false });
  if (uploadErr) {
    return NextResponse.json({ error: `Upload failed: ${uploadErr.message}` }, { status: 500 });
  }

  const previous = photo.annotatedPath;
  try {
    await db()
      .update(schema.auditPhotos)
      .set({ annotatedPath: path, annotation })
      .where(eq(schema.auditPhotos.id, photoId));
  } catch (err) {
    await admin.storage.from(ATTACHMENTS_BUCKET).remove([path]);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not save annotation" },
      { status: 500 },
    );
  }

  // Best-effort cleanup of the superseded render.
  if (previous && previous !== path) {
    await admin.storage.from(ATTACHMENTS_BUCKET).remove([previous]);
  }

  revalidatePath(`/properties/${propertyId}/audits/${auditId}`);
  return NextResponse.json({ ok: true });
}

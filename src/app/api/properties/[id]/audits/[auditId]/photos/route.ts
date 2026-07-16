import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { createClient } from "@/lib/supabase/server";
import { ATTACHMENTS_BUCKET, AUDIT_PHOTOS_PREFIX, createAdminClient } from "@/lib/supabase/admin";

const MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED = /\.(png|jpe?g|webp|gif|heic|heif)$/i;

function safeName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
}

export async function POST(
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

  const formData = await req.formData();
  const file = formData.get("file");
  const findingId = Number(formData.get("findingId"));
  if (!Number.isInteger(findingId)) {
    return NextResponse.json({ error: "Missing findingId" }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Image is larger than 25 MB" }, { status: 400 });
  }
  if (!ALLOWED.test(file.name)) {
    return NextResponse.json({ error: "Unsupported image type" }, { status: 400 });
  }

  // Verify finding → audit → property chain.
  const finding = await db().query.auditFindings.findFirst({
    where: eq(schema.auditFindings.id, findingId),
  });
  if (!finding || finding.auditId !== auditId) {
    return NextResponse.json({ error: "Finding not found" }, { status: 404 });
  }
  const audit = await db().query.siteAudits.findFirst({ where: eq(schema.siteAudits.id, auditId) });
  if (!audit || audit.propertyId !== propertyId) {
    return NextResponse.json({ error: "Audit not found" }, { status: 404 });
  }

  const gpsLat = formData.get("gpsLat");
  const gpsLng = formData.get("gpsLng");
  const takenAt = formData.get("takenAt");

  const admin = createAdminClient();
  const path = `${AUDIT_PHOTOS_PREFIX}/${auditId}/${findingId}/${crypto.randomUUID()}-${safeName(file.name)}`;
  const { error: uploadErr } = await admin.storage
    .from(ATTACHMENTS_BUCKET)
    .upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
  if (uploadErr) {
    return NextResponse.json({ error: `Upload failed: ${uploadErr.message}` }, { status: 500 });
  }

  try {
    const [{ maxOrder }] = await db()
      .select({ maxOrder: sql<number>`coalesce(max(${schema.auditPhotos.sortIndex}), 0)::int` })
      .from(schema.auditPhotos)
      .where(eq(schema.auditPhotos.findingId, findingId));

    const [row] = await db()
      .insert(schema.auditPhotos)
      .values({
        findingId,
        storagePath: path,
        sortIndex: maxOrder + 1,
        gpsLat: typeof gpsLat === "string" && gpsLat ? gpsLat : null,
        gpsLng: typeof gpsLng === "string" && gpsLng ? gpsLng : null,
        takenAt: typeof takenAt === "string" && takenAt ? new Date(takenAt) : null,
        uploadedBy: user.id,
      })
      .returning({ id: schema.auditPhotos.id });

    revalidatePath(`/properties/${propertyId}/audits/${auditId}`);
    return NextResponse.json({ ok: true, id: row.id });
  } catch (err) {
    await admin.storage.from(ATTACHMENTS_BUCKET).remove([path]);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not save photo" },
      { status: 500 },
    );
  }
}

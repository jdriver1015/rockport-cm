import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { createClient } from "@/lib/supabase/server";
import { ATTACHMENTS_BUCKET, createAdminClient } from "@/lib/supabase/admin";
import { propertyProjectPath } from "@/lib/property-path";

/**
 * A file filed against a bid — the vendor's own quote PDF, most often, for
 * whichever bid never went through the portal and so has no document of its
 * own anywhere else in the system.
 */

const MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED = /\.(pdf|png|jpe?g|webp|gif|docx?|xlsx?|csv|txt)$/i;

function safeName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; projectId: string; bidId: string }> },
) {
  const { id, projectId: pid, bidId: bid } = await ctx.params;
  const propertyId = Number(id);
  const projectId = Number(pid);
  const bidId = Number(bid);
  if (!Number.isInteger(propertyId) || !Number.isInteger(projectId) || !Number.isInteger(bidId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const bidRow = await db().query.bids.findFirst({
    where: and(eq(schema.bids.id, bidId), eq(schema.bids.projectId, projectId)),
  });
  if (!bidRow) return NextResponse.json({ error: "Bid not found" }, { status: 404 });

  const project = await db().query.projects.findFirst({
    where: and(eq(schema.projects.id, projectId), eq(schema.projects.propertyId, propertyId)),
  });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File is larger than 25 MB" }, { status: 400 });
  }
  if (!ALLOWED.test(file.name)) {
    return NextResponse.json(
      { error: "Unsupported file type — pdf, images, Office docs, csv, or txt" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const path = `bids/${bidId}/${crypto.randomUUID()}-${safeName(file.name)}`;

  const { error: uploadErr } = await admin.storage
    .from(ATTACHMENTS_BUCKET)
    .upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
  if (uploadErr) {
    return NextResponse.json({ error: `Upload failed: ${uploadErr.message}` }, { status: 500 });
  }

  try {
    const [row] = await db()
      .insert(schema.attachments)
      .values({
        propertyId,
        projectId,
        bidId,
        kind: "bid",
        storagePath: path,
        stageTag: project.stage,
        caption: file.name,
        uploadedBy: user.id,
      })
      .returning({ id: schema.attachments.id });
    const revalPath = await propertyProjectPath(propertyId, projectId);
    if (revalPath) revalidatePath(revalPath);
    return NextResponse.json({ ok: true, id: row.id });
  } catch (err) {
    await admin.storage.from(ATTACHMENTS_BUCKET).remove([path]);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not save attachment" },
      { status: 500 },
    );
  }
}

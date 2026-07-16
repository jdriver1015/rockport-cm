import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { createClient } from "@/lib/supabase/server";
import { ATTACHMENTS_BUCKET, createAdminClient } from "@/lib/supabase/admin";

/** Redirect to a short-lived signed URL for the batch's original GL file. */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; batchId: string }> },
) {
  const { id, batchId: bid } = await ctx.params;
  const propertyId = Number(id);
  const batchId = Number(bid);
  if (!Number.isInteger(propertyId) || !Number.isInteger(batchId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const batch = await db().query.importBatches.findFirst({
    where: eq(schema.importBatches.id, batchId),
  });
  if (!batch || batch.propertyId !== propertyId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!batch.storagePath) {
    return NextResponse.json({ error: "No original file stored for this import" }, { status: 404 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(ATTACHMENTS_BUCKET)
    .createSignedUrl(batch.storagePath, 60, { download: batch.fileName });
  if (error || !data) {
    return NextResponse.json({ error: "Could not create link" }, { status: 500 });
  }
  return NextResponse.redirect(data.signedUrl);
}

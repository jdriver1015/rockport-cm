import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { createClient } from "@/lib/supabase/server";
import { ATTACHMENTS_BUCKET, createAdminClient } from "@/lib/supabase/admin";

/** Redirect to a short-lived signed URL for a bid attachment (view/download). */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; projectId: string; bidId: string; attachmentId: string }> },
) {
  const { projectId: pid, bidId: bid, attachmentId: aid } = await ctx.params;
  const projectId = Number(pid);
  const bidId = Number(bid);
  const attachmentId = Number(aid);
  if (!Number.isInteger(projectId) || !Number.isInteger(bidId) || !Number.isInteger(attachmentId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const doc = await db().query.attachments.findFirst({
    where: and(
      eq(schema.attachments.id, attachmentId),
      eq(schema.attachments.projectId, projectId),
      eq(schema.attachments.bidId, bidId),
    ),
  });
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(ATTACHMENTS_BUCKET)
    .createSignedUrl(doc.storagePath, 60);
  if (error || !data) {
    return NextResponse.json({ error: "Could not create link" }, { status: 500 });
  }
  return NextResponse.redirect(data.signedUrl);
}

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { createClient } from "@/lib/supabase/server";
import { ATTACHMENTS_BUCKET, createAdminClient } from "@/lib/supabase/admin";

/** Redirect to a short-lived signed URL for the document (view/download). */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; projectId: string; docId: string }> },
) {
  const { projectId: pid, docId: did } = await ctx.params;
  const projectId = Number(pid);
  const docId = Number(did);
  if (!Number.isInteger(projectId) || !Number.isInteger(docId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const doc = await db().query.attachments.findFirst({
    where: and(eq(schema.attachments.id, docId), eq(schema.attachments.projectId, projectId)),
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

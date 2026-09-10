import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { createClient } from "@/lib/supabase/server";
import { ATTACHMENTS_BUCKET, createAdminClient } from "@/lib/supabase/admin";
import { propertyProjectPath } from "@/lib/property-path";
import { readContracts, recordExecutedContractRow } from "@/lib/contracts";

/**
 * The actual signed document — not the app's own generated PDF.
 *
 * POST records it: attaches the file to the award's contract and marks it
 * executed, whether or not that contract had ever been generated or walked
 * through Send / Vendor signs. GET serves it back, for whoever needs the
 * paper that was actually signed rather than the draft this app would print.
 */

const MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED = /\.(pdf|png|jpe?g|webp|gif|docx?)$/i;

function safeName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ projectId: string }> }) {
  const { projectId: pid } = await ctx.params;
  const projectId = Number(pid);
  if (!Number.isInteger(projectId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const project = await db().query.projects.findFirst({
    where: eq(schema.projects.id, projectId),
    columns: { propertyId: true },
  });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const formData = await req.formData();
  const file = formData.get("file");
  const bidIdRaw = formData.get("bidId");
  const bidId = typeof bidIdRaw === "string" ? Number(bidIdRaw) : NaN;
  if (!Number.isInteger(bidId)) {
    return NextResponse.json({ error: "Invalid bid id" }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File is larger than 25 MB" }, { status: 400 });
  }
  if (!ALLOWED.test(file.name)) {
    return NextResponse.json(
      { error: "Unsupported file type — pdf, images, or Word docs" },
      { status: 400 },
    );
  }

  // The bid has to belong to this project — otherwise a caller could attach a
  // signed file to another project's award by naming its bid id.
  const bid = await db().query.bids.findFirst({
    where: eq(schema.bids.id, bidId),
    columns: { projectId: true },
  });
  if (!bid || bid.projectId !== projectId) {
    return NextResponse.json({ error: "Bid not found on this project" }, { status: 404 });
  }

  const admin = createAdminClient();
  const path = `contracts/${bidId}/${crypto.randomUUID()}-${safeName(file.name)}`;

  const { error: uploadErr } = await admin.storage
    .from(ATTACHMENTS_BUCKET)
    .upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
  if (uploadErr) {
    return NextResponse.json({ error: `Upload failed: ${uploadErr.message}` }, { status: 500 });
  }

  const res = await recordExecutedContractRow(bidId, path);
  if (!res.ok) {
    await admin.storage.from(ATTACHMENTS_BUCKET).remove([path]);
    return NextResponse.json({ error: res.error }, { status: 400 });
  }

  const revalPath = await propertyProjectPath(project.propertyId, projectId);
  if (revalPath) revalidatePath(revalPath);
  return NextResponse.json({ ok: true, contractId: res.contractId });
}

/** Redirect to a short-lived signed URL for the actual signed document. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ projectId: string }> }) {
  const { projectId: pid } = await ctx.params;
  const projectId = Number(pid);
  if (!Number.isInteger(projectId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const asked = req.nextUrl.searchParams.get("contract");
  const contractId = asked == null ? NaN : Number(asked);
  if (!Number.isInteger(contractId)) {
    return NextResponse.json({ error: "Name a contract with ?contract=" }, { status: 400 });
  }

  const live = await readContracts(projectId);
  const chosen = live.find((c) => c.id === contractId);
  if (!chosen) return NextResponse.json({ error: "No such contract on this project" }, { status: 404 });

  const row = await db().query.projectContracts.findFirst({
    where: eq(schema.projectContracts.id, contractId),
    columns: { storageKey: true },
  });
  if (!row?.storageKey) {
    return NextResponse.json({ error: "No signed document on file" }, { status: 404 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(ATTACHMENTS_BUCKET)
    .createSignedUrl(row.storageKey, 60);
  if (error || !data) {
    return NextResponse.json({ error: "Could not create link" }, { status: 500 });
  }
  return NextResponse.redirect(data.signedUrl);
}

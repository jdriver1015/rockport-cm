import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { createClient } from "@/lib/supabase/server";
import { ATTACHMENTS_BUCKET, RENT_ROLLS_PREFIX, createAdminClient } from "@/lib/supabase/admin";

function safeName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
}

function fileKindOf(name: string): "pdf" | "csv" | "excel" {
  if (/\.pdf$/i.test(name)) return "pdf";
  if (/\.csv$/i.test(name)) return "csv";
  return "excel";
}

/**
 * Stage a rent-roll upload: archive the original to Storage and create a batch
 * in `parsing`. The heavy parse (AI column mapping / PDF extraction) runs in a
 * follow-up `parseBatch` server action so this request stays fast and never
 * hits a serverless timeout.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const propertyId = Number(id);
  if (!Number.isInteger(propertyId)) {
    return NextResponse.json({ error: "Invalid property id" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const property = await db().query.properties.findFirst({
    where: eq(schema.properties.id, propertyId),
  });
  if (!property) return NextResponse.json({ error: "Property not found" }, { status: 404 });

  const formData = await req.formData();
  const file = formData.get("file");
  const sourceSystem = (formData.get("sourceSystem") as string) || property.pmSystem || null;
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (!/\.(xlsx|xlsm|xls|csv|pdf)$/i.test(file.name)) {
    return NextResponse.json(
      { error: "Unsupported file type — upload .xlsx, .xls, .csv, or .pdf" },
      { status: 400 },
    );
  }

  const buffer = await file.arrayBuffer();

  const admin = createAdminClient();
  const storagePath = `${RENT_ROLLS_PREFIX}/${propertyId}/${crypto.randomUUID()}-${safeName(file.name)}`;
  const { error: uploadErr } = await admin.storage
    .from(ATTACHMENTS_BUCKET)
    .upload(storagePath, buffer, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
  if (uploadErr) {
    return NextResponse.json({ error: `Upload failed: ${uploadErr.message}` }, { status: 500 });
  }

  try {
    const [batch] = await db()
      .insert(schema.rentRollBatches)
      .values({
        propertyId,
        fileName: file.name,
        storagePath,
        sourceSystem,
        fileKind: fileKindOf(file.name),
        status: "parsing",
        parseProgress: { stage: "queued", pct: 5 },
        uploadedBy: user.id,
      })
      .returning();
    return NextResponse.json({ ok: true, batchId: batch.id });
  } catch (err) {
    await admin.storage.from(ATTACHMENTS_BUCKET).remove([storagePath]);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not stage upload" },
      { status: 422 },
    );
  }
}

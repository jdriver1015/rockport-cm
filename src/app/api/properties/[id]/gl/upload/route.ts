import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { createClient } from "@/lib/supabase/server";
import { ATTACHMENTS_BUCKET, GL_IMPORTS_PREFIX, createAdminClient } from "@/lib/supabase/admin";
import { parseGlWorkbook, suggestConstructionAccount } from "@/lib/gl-import";
import { insertMappedTransactions, type AccountSummary } from "@/lib/gl-import-pipeline";

function safeName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const propertyId = Number(id);
  if (!Number.isInteger(propertyId)) {
    return NextResponse.json({ error: "Invalid property id" }, { status: 400 });
  }

  // Require an authenticated session before touching the service-role client.
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
  if (!/\.(xlsx|xlsm|xls|csv)$/i.test(file.name)) {
    return NextResponse.json(
      { error: "Unsupported file type — upload .xlsx, .xls, or .csv" },
      { status: 400 },
    );
  }

  // Read the file once: the same bytes are both parsed and archived to storage.
  const buffer = await file.arrayBuffer();

  let parsed;
  try {
    parsed = parseGlWorkbook(buffer);
  } catch (err) {
    return NextResponse.json(
      { error: `Could not read workbook: ${err instanceof Error ? err.message : String(err)}` },
      { status: 422 },
    );
  }

  if (parsed.rows.length === 0) {
    return NextResponse.json(
      {
        error:
          "No transactions recognized. Expect a header row naming a vendor/description column and an amount column.",
      },
      { status: 422 },
    );
  }

  // Archive the original file first so the import is reproducible/auditable and
  // can be re-parsed (e.g. after account selection) without a re-upload.
  const admin = createAdminClient();
  const storagePath = `${GL_IMPORTS_PREFIX}/${propertyId}/${crypto.randomUUID()}-${safeName(file.name)}`;
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
    // A grouped ledger (Yardi/ResMan) is the whole property book — most account
    // sections are operational noise. Decide which sections to import: reuse the
    // per-property memory where it exists, and route the rest through a selection
    // step. A flat file with no sections skips straight to review.
    const remembered = parsed.layout === "grouped"
      ? new Map(
          (
            await db()
              .select({
                accountCode: schema.glPropertyAccounts.accountCode,
                isConstruction: schema.glPropertyAccounts.isConstruction,
              })
              .from(schema.glPropertyAccounts)
              .where(eq(schema.glPropertyAccounts.propertyId, propertyId))
          ).map((r) => [r.accountCode, r.isConstruction]),
        )
      : new Map<string, boolean>();

    const hasUndecided =
      parsed.layout === "grouped" && parsed.sections.some((s) => !remembered.has(s.code));

    if (parsed.layout === "grouped" && hasUndecided) {
      // Stage the section summaries and wait for the user to pick accounts. No
      // transactions are materialized yet.
      const summary: AccountSummary[] = parsed.sections.map((s) => ({
        code: s.code,
        name: s.name,
        rowCount: s.rows.length,
        total: s.total,
        suggested: remembered.get(s.code) ?? suggestConstructionAccount(s.code, s.name),
        remembered: remembered.has(s.code),
      }));

      const [batch] = await db()
        .insert(schema.importBatches)
        .values({
          propertyId,
          fileName: file.name,
          storagePath,
          sourceSystem,
          status: "needs_accounts",
          rowCount: 0,
          periodDate: parsed.periodDate,
          accountSummary: summary,
          uploadedBy: user.id,
        })
        .returning();

      return NextResponse.json({
        ok: true,
        batchId: batch.id,
        needsAccounts: true,
        accountCount: summary.length,
        suggestedCount: summary.filter((s) => s.suggested).length,
      });
    }

    // Auto path: flat layout, or a grouped layout whose every account is already
    // decided in memory. Import only the construction accounts' rows.
    const rowsToImport =
      parsed.layout === "grouped"
        ? parsed.rows.filter((r) => r.glAccountRaw != null && remembered.get(r.glAccountRaw))
        : parsed.rows;

    const [batch] = await db()
      .insert(schema.importBatches)
      .values({
        propertyId,
        fileName: file.name,
        storagePath,
        sourceSystem,
        status: "in_review",
        rowCount: rowsToImport.length,
        periodDate: parsed.periodDate,
        uploadedBy: user.id,
      })
      .returning();

    const counts = await insertMappedTransactions(propertyId, batch.id, rowsToImport);
    await db()
      .update(schema.importBatches)
      .set({ autoMappedCount: counts.autoMappedCount, needsReviewCount: counts.needsReviewCount })
      .where(eq(schema.importBatches.id, batch.id));

    return NextResponse.json({
      ok: true,
      batchId: batch.id,
      rowCount: counts.rowCount,
      autoMappedCount: counts.autoMappedCount,
      needsReviewCount: counts.needsReviewCount,
      duplicates: counts.duplicates,
      skipped: parsed.skipped,
    });
  } catch (err) {
    // Roll back the stored object if the DB write failed.
    await admin.storage.from(ATTACHMENTS_BUCKET).remove([storagePath]);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not save import" },
      { status: 500 },
    );
  }
}

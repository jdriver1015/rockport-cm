import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import {
  autoMapRow,
  dedupeKey,
  parseGlWorkbook,
  type MapContext,
  type MappingRule,
} from "@/lib/gl-import";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const propertyId = Number(id);
  if (!Number.isInteger(propertyId)) {
    return NextResponse.json({ error: "Invalid property id" }, { status: 400 });
  }

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

  let parsed;
  try {
    parsed = parseGlWorkbook(await file.arrayBuffer());
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

  // Build the mapping context from current DB state
  const rules: MappingRule[] = (
    await db()
      .select({
        matchType: schema.mappingRules.matchType,
        pattern: schema.mappingRules.pattern,
        costCodeId: schema.mappingRules.costCodeId,
        priority: schema.mappingRules.priority,
      })
      .from(schema.mappingRules)
      .where(eq(schema.mappingRules.active, true))
  )
    .map((r) => ({ ...r, matchType: r.matchType as MappingRule["matchType"] }))
    .sort((a, b) => a.priority - b.priority);

  const codes = await db()
    .select({ id: schema.costCodes.id, isInterior: schema.costCodes.isInterior })
    .from(schema.costCodes);
  const interiorByCode = new Map(codes.map((c) => [c.id, c.isInterior]));

  const units = await db()
    .select({ id: schema.units.id, unitNumber: schema.units.unitNumber })
    .from(schema.units)
    .where(eq(schema.units.propertyId, propertyId));
  const unitIdByNumber = new Map(units.map((u) => [u.unitNumber.toUpperCase(), u.id]));

  const projects = await db()
    .select({
      id: schema.projects.id,
      kind: schema.projects.kind,
      costCodeId: schema.projects.costCodeId,
      unitId: schema.projects.unitId,
    })
    .from(schema.projects)
    .where(eq(schema.projects.propertyId, propertyId));

  const unitProjectByUnitId = new Map<number, number>();
  const commonProjectsByCode = new Map<number, number[]>();
  for (const p of projects) {
    if (p.kind === "unit" && p.unitId != null) unitProjectByUnitId.set(p.unitId, p.id);
    if (p.kind === "common" && p.costCodeId != null) {
      const arr = commonProjectsByCode.get(p.costCodeId) ?? [];
      arr.push(p.id);
      commonProjectsByCode.set(p.costCodeId, arr);
    }
  }

  const postedRows = await db()
    .select({
      vendorRaw: schema.glTransactions.vendorRaw,
      amount: schema.glTransactions.amount,
      invoiceNo: schema.glTransactions.invoiceNo,
    })
    .from(schema.glTransactions)
    .where(
      and(
        eq(schema.glTransactions.propertyId, propertyId),
        eq(schema.glTransactions.status, "posted"),
      ),
    );
  const postedKeys = new Set(
    postedRows.map((r) => dedupeKey(r.vendorRaw, parseFloat(r.amount), r.invoiceNo)),
  );

  const mapCtx: MapContext = {
    rules,
    interiorByCode,
    unitIdByNumber,
    unitProjectByUnitId,
    commonProjectsByCode,
    postedKeys,
  };

  // Flag duplicates against already-posted rows AND earlier rows in this same file
  const mapped = parsed.rows.map((r) => {
    const m = autoMapRow(r, mapCtx);
    mapCtx.postedKeys.add(dedupeKey(r.vendorRaw, r.amount, r.invoiceNo));
    return m;
  });
  const autoMappedCount = mapped.filter((m) => m.status === "staged").length;
  const needsReviewCount = mapped.filter((m) => m.status === "needs_review").length;

  const [batch] = await db()
    .insert(schema.importBatches)
    .values({
      propertyId,
      fileName: file.name,
      sourceSystem,
      status: "in_review",
      rowCount: mapped.length,
      autoMappedCount,
      needsReviewCount,
    })
    .returning();

  await db()
    .insert(schema.glTransactions)
    .values(
      mapped.map((m) => ({
        propertyId,
        batchId: batch.id,
        costCodeId: m.costCodeId,
        projectId: m.projectId,
        vendorRaw: m.vendorRaw,
        description: m.description,
        amount: m.amount.toFixed(2),
        txnDate: m.txnDate,
        invoiceNo: m.invoiceNo,
        checkNo: m.checkNo,
        drawNo: m.drawNo,
        unitLabel: m.unitLabel,
        glAccountRaw: m.glAccountRaw,
        status: m.status,
        sourceRow: m.sourceRow,
        // Duplicates start excluded with a reason so they don't double-count unless un-excluded
        ...(m.isDuplicate ? { status: "excluded" as const, excludeReason: "Possible duplicate" } : {}),
      })),
    );

  return NextResponse.json({
    ok: true,
    batchId: batch.id,
    rowCount: mapped.length,
    autoMappedCount,
    needsReviewCount,
    duplicates: mapped.filter((m) => m.isDuplicate).length,
    skipped: parsed.skipped,
  });
}

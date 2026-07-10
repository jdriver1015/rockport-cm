import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { parseBudgetWorkbook } from "@/lib/budget-import";

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
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (!/\.(xlsx|xlsm|xls|csv)$/i.test(file.name)) {
    return NextResponse.json(
      { error: "Unsupported file type — upload .xlsx, .xls, or .csv" },
      { status: 400 },
    );
  }

  const coa = await db()
    .select({
      id: schema.costCodes.id,
      code: schema.costCodes.code,
      name: schema.costCodes.name,
      isInterior: schema.costCodes.isInterior,
    })
    .from(schema.costCodes)
    .where(eq(schema.costCodes.active, true));

  let result;
  try {
    result = parseBudgetWorkbook(await file.arrayBuffer(), coa);
  } catch (err) {
    return NextResponse.json(
      { error: `Could not read workbook: ${err instanceof Error ? err.message : String(err)}` },
      { status: 422 },
    );
  }

  if (result.rows.length === 0) {
    return NextResponse.json(
      {
        error:
          "No budget rows recognized. Expect a 'Cost Code' column (####-####) or cost-code names with amounts.",
        unmatched: result.unmatched,
      },
      { status: 422 },
    );
  }

  // Annotate with existing budget amounts so the preview can show what changes
  const existing = await db()
    .select({
      costCodeId: schema.budgetLines.costCodeId,
      uwAmount: schema.budgetLines.uwAmount,
    })
    .from(schema.budgetLines)
    .where(eq(schema.budgetLines.propertyId, propertyId));
  const existingByCode = new Map(existing.map((e) => [e.costCodeId, parseFloat(e.uwAmount)]));

  return NextResponse.json({
    ...result,
    rows: result.rows.map((r) => ({
      ...r,
      existingAmount: existingByCode.get(r.costCodeId) ?? null,
    })),
    fileName: file.name,
  });
}

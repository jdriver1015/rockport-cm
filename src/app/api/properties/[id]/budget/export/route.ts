import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { createClient } from "@/lib/supabase/server";
import { computePropertyBudget } from "@/lib/property-budget";
import { buildBudgetWorkbook } from "@/lib/budget-export";

/**
 * The property's whole budget, as a two-sheet workbook.
 *
 * Built from computePropertyBudget — the same function the Budget tab renders
 * from — so what downloads matches what was on screen when it was requested,
 * not a second query that could disagree with it.
 *
 * Signed-in only, same as the project sheet PDF: this carries the property's
 * full underwriting.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const propertyId = Number(id);
  if (!Number.isInteger(propertyId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
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

  const budget = await computePropertyBudget(propertyId, property.chartOfAccountsId);
  const buffer = await buildBudgetWorkbook(budget);
  const filename = `${property.name} - budget.xlsx`.replace(/[^a-zA-Z0-9 .\-_]/g, "_");

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      // attachment, not inline: a browser cannot render a workbook the way it
      // renders a PDF, so letting it try is a broken tab instead of a download.
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

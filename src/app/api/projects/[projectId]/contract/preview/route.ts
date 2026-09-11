import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { ContractDocument } from "@/lib/contract-document";
import { previewContractData } from "@/lib/contracts";

/**
 * What Generate would produce for one awarded bid, rendered without writing
 * anything — the look-before-you-commit step the draft-row flow skipped.
 *
 * Signed-in only, like the generated-contract route: this names a vendor and
 * a price, and nothing about a contract should be reachable with a link alone.
 */
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

  const bidIdRaw = req.nextUrl.searchParams.get("bidId");
  const bidId = bidIdRaw == null ? NaN : Number(bidIdRaw);
  if (!Number.isInteger(bidId)) {
    return NextResponse.json({ error: "Name a bid with ?bidId=" }, { status: 400 });
  }

  const bid = await db().query.bids.findFirst({
    where: eq(schema.bids.id, bidId),
    columns: { projectId: true },
  });
  if (!bid || bid.projectId !== projectId) {
    return NextResponse.json({ error: "Bid not found on this project" }, { status: 404 });
  }

  const res = await previewContractData(bidId);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });

  const buffer = await renderToBuffer(ContractDocument({ data: res.data }));
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="preview.pdf"`,
      // A preview is only as current as the bid and template it was built
      // from — never worth caching.
      "Cache-Control": "no-store",
    },
  });
}

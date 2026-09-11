import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { ContractDocument } from "@/lib/contract-document";
import { previewContractData } from "@/lib/contracts";
import { pdfResponse, requireSignedInApiUser } from "@/lib/pdf-route";

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

  const auth = await requireSignedInApiUser();
  if (!auth.ok) return auth.response;

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
  return pdfResponse(buffer, "preview.pdf");
}

import { NextRequest, NextResponse } from "next/server";
import { lookupPortalBid } from "@/lib/bid-portal";
import { recordEmailOpen } from "@/lib/bid-events";

/**
 * The open pixel on a bid invitation.
 *
 * Keyed by the same token as the portal link, so an open is attributable to one
 * vendor without putting an id in the URL. It is a weak signal by nature —
 * clients that block images never fire it, and Gmail's proxy fetches it once
 * whether or not a human looked — which is why the bid screen treats a click on
 * the link as the stronger evidence and shows both.
 *
 * Always returns the pixel. A dead or revoked token still gets a transparent
 * GIF rather than a 404, because a broken image in somebody's inbox is a worse
 * outcome than an unrecorded open.
 */

// 1x1 transparent GIF.
const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);

function pixel() {
  return new NextResponse(new Uint8Array(PIXEL), {
    headers: {
      "Content-Type": "image/gif",
      "Content-Length": String(PIXEL.length),
      // Without this every proxy would serve its own copy and the second open
      // would never reach us.
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
      Pragma: "no-cache",
    },
  });
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;

  try {
    const found = await lookupPortalBid(token);
    if (found.ok) await recordEmailOpen(found.bid.bidId);
  } catch (err) {
    // Never let the trail break the image.
    console.error("bid open pixel failed", err);
  }

  return pixel();
}

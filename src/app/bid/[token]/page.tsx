import type { Metadata } from "next";
import { BidPortalForm } from "@/components/bid-portal-form";
import { lookupPortalBid } from "@/lib/bid-portal";
import { recordOncePerHour } from "@/lib/bid-events";

export const dynamic = "force-dynamic";

/**
 * Never indexed. The URL is the credential, so a crawler following one into a
 * search index would publish it.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
  title: "Bid request",
};

/**
 * The vendor portal — the one page in this app with no signed-in user.
 *
 * The token in the URL is the only authorisation, and it is resolved to exactly
 * one bid. Nothing here takes a project or bid id from the request, because there
 * is no session to check such an id against.
 *
 * Note for anyone adding to this page: it is world-readable. Render what the
 * vendor needs to price their own work and nothing else — no other bids, no
 * budget, no other vendors, no internal notes.
 */
export default async function BidPortalPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const found = await lookupPortalBid(token);

  if (!found.ok) {
    // Every failure looks the same to a guesser except expiry, which a vendor
    // genuinely needs to distinguish so they know to ask for a new link.
    const message =
      found.reason === "expired"
        ? "This bid link has expired. Contact the sender for a new one."
        : found.reason === "revoked"
          ? "This bid link has been withdrawn. Contact the sender if you think that is a mistake."
          : "This bid link is not valid. Check that you copied the whole address.";
    return (
      <main className="mx-auto max-w-md px-6 py-20">
        <h1 className="font-serif text-xl font-semibold text-navy">Bid request</h1>
        <p className="mt-2 text-[14px] text-ink-500">{message}</p>
      </main>
    );
  }

  const bid = found.bid;

  // A vendor actually opening the portal is far better evidence than a tracking
  // pixel: images get blocked and proxies prefetch, but nobody lands here by
  // accident. Recorded on render rather than on submit so a vendor who looks and
  // walks away still shows as having looked — but at most once an hour, because
  // this page also re-renders on the router refresh that follows a submission,
  // and a vendor's own answer should not read as three more visits.
  await recordOncePerHour(bid.bidId, "link_opened");

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <header className="border-b-2 border-navy pb-4">
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-300">
          Request for pricing · Bid #{bid.bidNumber}
        </p>
        <h1 className="mt-1 font-serif text-2xl font-semibold text-navy">{bid.propertyName}</h1>
        <p className="text-[14px] text-ink-500">{bid.projectName}</p>
        {bid.vendorName && (
          <p className="mt-2 text-[13px] text-muted-foreground">Prepared for {bid.vendorName}</p>
        )}
      </header>

      <p className="mt-5 text-[14px] text-ink-700">
        Price each line below. Leave a line blank if it is included elsewhere or you are not bidding
        it — blanks are submitted as zero.
      </p>

      <div className="mt-5">
        <BidPortalForm token={token} bid={bid} />
      </div>

      <footer className="mt-8 border-t border-border pt-3 text-[11px] text-muted-foreground">
        This link is private to you and expires{" "}
        {bid.expiresAt.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })}
        . Please do not forward it.
      </footer>
    </main>
  );
}

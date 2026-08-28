"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { fmtDate, money } from "@/lib/format";
import { issueLink, revokeLink } from "@/lib/actions/bid-portal";
import type { BidPackageOption } from "@/lib/bid-package";
import type { BidProgress } from "@/lib/bid-events";
import { BidInviteWizard } from "@/components/bid-invite-wizard";
import { setBidWinner } from "@/lib/actions/bids";

/**
 * The vendor's link for one bid.
 *
 * Copying puts a URL on the clipboard that anyone holding it can price with, so
 * the button says what it is rather than just "copy". Reissuing revokes the
 * previous link, which is the way to kill one that went to the wrong address.
 */
function BidLink({
  projectId,
  bid,
  disabled,
}: {
  projectId: number;
  bid: { id: number; token: string | null; approved: boolean; status: string };
  disabled: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // A decided bid has nothing left for the vendor to do.
  if (bid.approved || bid.status === "declined") return null;

  async function copy(token: string) {
    const url = `${window.location.origin}/bid/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied — send it to the vendor");
    } catch {
      // Clipboard access can be refused; showing the URL still gets the job done.
      toast.info(url, { duration: 20000 });
    }
  }

  function mint(reissue: boolean) {
    startTransition(async () => {
      const res = await issueLink({ bidId: bid.id, projectId });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      await copy(res.token);
      if (reissue) toast.info("The previous link no longer works");
      router.refresh();
    });
  }

  return (
    <span className="flex shrink-0 items-center gap-1">
      {bid.token ? (
        <>
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled || pending}
            onClick={() => copy(bid.token!)}
          >
            Copy link
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled || pending}
            title="Issue a new link and stop the old one working"
            onClick={() => mint(true)}
          >
            Reissue
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-alert hover:text-alert"
            disabled={disabled || pending}
            onClick={() =>
              startTransition(async () => {
                const res = await revokeLink({ bidId: bid.id, projectId });
                if (!res.ok) {
                  toast.error(res.error);
                  return;
                }
                toast.success("Link revoked");
                router.refresh();
              })
            }
          >
            Revoke
          </Button>
        </>
      ) : (
        <Button size="sm" variant="outline" disabled={disabled || pending} onClick={() => mint(false)}>
          {pending ? "…" : "Get link"}
        </Button>
      )}
    </span>
  );
}

/** Which statuses mean the request is still with the vendor. */
const LIVE = new Set(["draft", "sent"]);

const LABEL = "text-[10.5px] font-semibold uppercase tracking-[0.09em] text-ink-300";

/**
 * Resolve the Select Bid gate: send the scope out, and see what has come back.
 *
 * Sending is the top half and reviewing the bottom, because they are the same
 * question a week apart — "who has this?" and "what did they say?" — and
 * splitting them across two dialogs would mean guessing which one you wanted.
 */
export function SelectBidDialog({
  open,
  onOpenChange,
  propertyId,
  projectId,
  data,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Awarding revalidates the property's pages, not just this project's. */
  propertyId: number;
  projectId: number;
  data: BidPackageOption;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Two modes rather than two dialogs: sending and reviewing are the same
  // question a week apart, and splitting them would mean guessing which one
  // somebody wanted when they opened the gate.
  const [mode, setMode] = useState<"compare" | "invite">("compare");

  function award(bidId: number, vendorName: string) {
    startTransition(async () => {
      const res = await setBidWinner({ id: bidId, propertyId, projectId });
      if (!res.ok) {
        // Overlap is the interesting refusal: another award already holds some
        // of these lines, and the message names who.
        toast.error(res.error);
        return;
      }
      toast.success(`Awarded to ${vendorName}`);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Bids</DialogTitle>
          <DialogDescription>
            Send the scope out for pricing, then pick the bid you want. Each vendor gets its own
            copy — nobody sees anyone else&apos;s numbers.
          </DialogDescription>
        </DialogHeader>

        {mode === "invite" ? (
          <BidInviteWizard
            propertyId={propertyId}
            projectId={projectId}
            data={data}
            onClose={() => setMode("compare")}
          />
        ) : (
        <div className="max-h-[70vh] space-y-5 overflow-y-auto">
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setMode("invite")}>
              {data.bids.length > 0 ? "Invite more vendors" : "Send for pricing"}
            </Button>
          </div>

          {/* ---------- what has come back ---------- */}
          <BidMatrix data={data} pending={pending} onAward={award} />

          {/* The portal links stay a list: they are per vendor and have nothing
              to compare against each other. */}
          {data.bids.length > 0 && (
            <div className="space-y-2">
              <span className={LABEL}>Vendor links</span>
              <div className="divide-y divide-hairline rounded-card border border-border">
                {data.bids.map((b) => (
                  <div key={b.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                    <span className="min-w-0 flex-1 text-[13px] text-ink-700">
                      {b.vendorName ?? "Vendor removed"}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {b.sentAt ? `sent ${fmtDate(b.sentAt)}` : "not sent"}
                    </span>
                    <BidLink projectId={projectId} bid={b} disabled={pending} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Every vendor's price against every scope line.
 *
 * The comparison used to be a list of bids with one total each: you could see
 * that Ace was cheaper overall and nothing about where. Which line each vendor
 * is actually good at is the whole question when several price the same scope,
 * and it is also what makes a split award possible — Ace for the countertops,
 * Bolt for the millwork.
 */
function BidMatrix({
  data,
  pending,
  onAward,
}: {
  data: BidPackageOption;
  pending: boolean;
  /** Awarding is the parent's job — it owns the transition and the refresh. */
  onAward: (bidId: number, vendorName: string) => void;
}) {
  // Only bids that carry a price. A request still out is shown as a column so
  // you can see who has not answered, but it has nothing to compare.
  const columns = data.bids.filter((b) => b.status !== "withdrawn");

  const priceOf = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of data.lineAmounts) m.set(`${l.bidId}:${l.scopeItemId}`, l.amount);
    return m;
  }, [data.lineAmounts]);

  // Whether a bid has come back decides what a zero means. A request goes out
  // with its lines seeded at zero, so while it is still out a zero is an
  // unanswered line. Once the vendor has submitted, the portal deliberately
  // stores a line they declined as zero — reading THAT as "not asked" is the
  // exact misreport the portal set out to avoid, and it also dropped the vendor
  // below full coverage so they could never be marked cheapest.
  const returned = new Map(data.bids.map((b) => [b.id, !!b.receivedDate]));
  const priced = (bidId: number, lineId: number): number | null => {
    const v = priceOf.get(`${bidId}:${lineId}`);
    if (v == null) return null;
    if (v > 0) return v;
    return returned.get(bidId) ? 0 : null;
  };

  const linesPricedBy = (bidId: number) =>
    data.scopeItems.filter((s) => priced(bidId, s.id) != null).length;

  const totalFor = (bidId: number) =>
    data.scopeItems.reduce((sum, s) => sum + (priced(bidId, s.id) ?? 0), 0);

  const estimateTotal = data.scopeItems.reduce((s, i) => s + (i.budgeted ?? 0), 0);

  // The cheapest total is only meaningful among vendors who priced the WHOLE
  // scope. A vendor asked for one line will always look cheapest, and marking
  // it would be recommending less work rather than a better price.
  const fullCoverageBids = columns.filter(
    (b) => linesPricedBy(b.id) === data.scopeItems.length && data.scopeItems.length > 0,
  );
  const bestTotalBidId =
    fullCoverageBids.length > 1
      ? fullCoverageBids.reduce((best, b) => (totalFor(b.id) < totalFor(best.id) ? b : best)).id
      : null;

  if (columns.length === 0 || data.scopeItems.length === 0) return null;

  return (
    <div className="space-y-2">
      <span className={LABEL}>Priced by line · {data.scopeItems.length} items</span>

      <div className="overflow-x-auto rounded-card border border-border">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr>
              <th className={cn(LABEL, "border-b border-border px-3 py-2 text-left")}>Scope item</th>
              <th className={cn(LABEL, "border-b border-border px-3 py-2 text-right")}>
                Our estimate
              </th>
              {columns.map((b) => (
                <th
                  key={b.id}
                  className="min-w-[124px] border-b border-border border-l border-hairline px-3 py-2 text-left align-bottom"
                >
                  <div className="text-[13px] font-semibold text-navy">
                    {b.vendorName ?? "Vendor removed"}
                  </div>
                  <span
                    className={cn(
                      "mt-1 inline-block rounded px-1.5 py-px text-[9.5px] font-bold uppercase tracking-[0.07em]",
                      b.approved
                        ? "bg-positive/10 text-positive"
                        : b.receivedDate
                          ? "bg-positive-bg text-positive"
                          : LIVE.has(b.status)
                            ? "bg-track text-ink-400"
                            : "bg-muted text-ink-500",
                    )}
                  >
                    {b.approved
                      ? "awarded"
                      : b.receivedDate
                        ? `back ${fmtDate(b.receivedDate)}`
                        : b.status}
                  </span>
                  <VendorTrail progress={b.progress} submitted={!!b.receivedDate} />
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {data.scopeItems.map((line) => {
              const prices = columns
                .map((b) => ({ bidId: b.id, amount: priced(b.id, line.id) }))
                .filter((p): p is { bidId: number; amount: number } => p.amount != null);
              const low = prices.length > 1 ? Math.min(...prices.map((p) => p.amount)) : null;

              return (
                <tr key={line.id}>
                  <td className="border-b border-hairline px-3 py-2">
                    <div className="text-[13px] font-semibold text-navy">{line.item}</div>
                    <div className="text-[10.5px] text-ink-300">
                      {line.costCodeName ?? "No budget category"}
                    </div>
                  </td>
                  <td className="border-b border-hairline px-3 py-2 text-right text-[12px] tabular-nums text-ink-400">
                    {line.budgeted != null ? money(line.budgeted) : "—"}
                  </td>
                  {columns.map((b) => {
                    const amount = priced(b.id, line.id);
                    const isLow = low != null && amount === low;
                    const delta =
                      amount != null && line.budgeted != null ? amount - line.budgeted : null;
                    return (
                      <td
                        key={b.id}
                        className={cn(
                          "border-b border-hairline border-l border-hairline px-3 py-2 text-right tabular-nums",
                          isLow && "bg-positive-bg",
                        )}
                      >
                        {amount == null ? (
                          // Never asked, which is not the same as quoted at zero.
                          <span className="text-[11px] text-ink-200 italic">not asked</span>
                        ) : amount === 0 ? (
                          // Answered, with nothing against it.
                          <span className="text-[11px] text-ink-400 italic">no bid</span>
                        ) : (
                          <>
                            <div
                              className={cn(
                                "text-[13px]",
                                isLow ? "font-bold text-positive" : "text-ink-700",
                              )}
                            >
                              {money(amount)}
                            </div>
                            {delta != null && delta !== 0 && (
                              <div
                                className={cn(
                                  "text-[10px]",
                                  isLow ? "text-positive" : delta > 0 ? "text-alert" : "text-ink-300",
                                )}
                              >
                                {money(Math.abs(delta))} {delta > 0 ? "over" : "under"}
                              </div>
                            )}
                          </>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}

            <tr className="bg-band">
              <td className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-[0.09em] text-ink-500">
                Total priced
              </td>
              <td className="px-3 py-2.5 text-right text-[13px] font-bold tabular-nums text-ink-900">
                {estimateTotal > 0 ? money(estimateTotal) : "—"}
              </td>
              {columns.map((b) => {
                const total = totalFor(b.id);
                const covered = linesPricedBy(b.id);
                const isBest = b.id === bestTotalBidId;
                return (
                  <td
                    key={b.id}
                    className={cn(
                      "px-3 py-2.5 text-right tabular-nums",
                      isBest ? "bg-positive/15" : "",
                    )}
                  >
                    <div
                      className={cn(
                        "text-[14px] font-bold",
                        isBest ? "text-positive" : "text-ink-900",
                      )}
                    >
                      {total > 0 ? money(total) : "—"}
                    </div>
                    <div className="text-[10px] text-ink-400">
                      {covered} of {data.scopeItems.length} lines
                    </div>
                  </td>
                );
              })}
            </tr>

            <tr className="bg-band">
              <td colSpan={2} className="px-3 pb-3" />
              {columns.map((b) => {
                const covered = linesPricedBy(b.id);
                return (
                  <td key={b.id} className="px-3 pb-3 text-center">
                    {b.approved ? (
                      <span className="text-[11px] font-bold uppercase tracking-[0.07em] text-positive">
                        ✓ Awarded
                      </span>
                    ) : covered === 0 ? (
                      <span className="text-[11px] text-ink-300">Still out</span>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        className="w-full"
                        onClick={() => onAward(b.id, b.vendorName ?? "this vendor")}
                      >
                        Award {b.vendorName?.split(" ")[0] ?? "bid"}
                      </Button>
                    )}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Awarding covers every line that vendor priced. Two vendors can both be awarded when their
        lines do not overlap — the cheapest total is only marked among vendors who priced the whole
        scope, because a smaller number for fewer lines is not a better price.
      </p>
    </div>
  );
}


/**
 * How far one vendor has got, in a line.
 *
 * The question this screen is really asked is "who do I chase", and a status of
 * "sent" answered it with silence. A vendor who has not opened the email and one
 * who is halfway through pricing both read as "sent", and they need opposite
 * treatment.
 */
function VendorTrail({ progress, submitted }: { progress: BidProgress; submitted: boolean }) {
  // Once a bid is in, the trail that led to it is history — the number is the
  // point, not how long they took to reach it.
  if (submitted) return null;

  const parts: string[] = [];

  if (progress.startedPricing) parts.push("started pricing");
  else if (progress.lastSeenAt) parts.push(progress.opens > 1 ? `opened ${progress.opens}×` : "opened");
  else if (progress.invitedAt) parts.push("not opened");

  if (progress.lastSeenAt) parts.push(ago(progress.lastSeenAt));

  if (parts.length === 0) return null;

  return (
    <div
      className={cn(
        "mt-1 text-[10px] leading-tight",
        progress.startedPricing ? "text-positive" : progress.lastSeenAt ? "text-ink-400" : "text-gold",
      )}
    >
      {parts.join(" · ")}
    </div>
  );
}

/** Rough, and rough is what "have they looked at it" needs. */
function ago(at: Date): string {
  const mins = Math.max(0, Math.round((Date.now() - at.getTime()) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

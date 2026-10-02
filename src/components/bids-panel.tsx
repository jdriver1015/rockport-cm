"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckIcon, EllipsisIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { fmtDate, money } from "@/lib/format";
import { issueLink, revokeLink } from "@/lib/actions/bid-portal";
import type { BidPackageOption } from "@/lib/bid-package";
import type { BidProgress } from "@/lib/bid-events";
import { BidInviteWizard } from "@/components/bid-invite-wizard";
import { ManualBidPanel } from "@/components/manual-bid-panel";
import { AwardFromAgreementPanel } from "@/components/award-from-agreement-panel";
import { BidAttachments } from "@/components/bid-attachments";
import { clearBidWinner, setBidWinner } from "@/lib/actions/bids";

type Bid = BidPackageOption["bids"][number];

const LABEL = "text-[10.5px] font-semibold uppercase tracking-[0.09em] text-ink-300";

/**
 * The bids half of the Scope & Bids step: send the scope out, and see what has
 * come back.
 *
 * One table, not a comparison plus a list of the same bids underneath it. Each
 * vendor is a column, and everything about that vendor — its status, its link,
 * its files, the award — lives in that column, so there is one place to look
 * for "who has this?" and "what did they say?".
 */
export function BidsPanel({
  propertyId,
  projectId,
  data,
  scopeBlocker,
  onEditScope,
}: {
  /** Awarding revalidates the property's pages, not just this project's. */
  propertyId: number;
  projectId: number;
  data: BidPackageOption;
  /**
   * Why the scope cannot go out yet, or null when it can. Sending or awarding
   * confirms the scope, so both wait on it; recording a bid by hand does not.
   */
  scopeBlocker: string | null;
  onEditScope: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Modes rather than separate dialogs: sending, reviewing, and recording a bid
  // by hand are the same screen at different moments.
  const [mode, setMode] = useState<"compare" | "invite" | "manual" | "agreement">("compare");
  // Set when "Edit bid" is chosen on an existing bid; undefined means the manual
  // panel is recording a new one.
  const [editingBidId, setEditingBidId] = useState<number | undefined>(undefined);

  function openManual(bidId?: number) {
    setEditingBidId(bidId);
    setMode("manual");
  }

  /** `replace` un-awards whoever holds any of these lines — the "award instead" path. */
  function award(bidId: number, vendorName: string, replace = false) {
    startTransition(async () => {
      const res = await setBidWinner({
        id: bidId,
        propertyId,
        projectId,
        replaceOverlapping: replace,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`Awarded to ${vendorName}`);
      router.refresh();
    });
  }

  function takeBack(bidId: number, vendorName: string) {
    startTransition(async () => {
      const res = await clearBidWinner({ id: bidId, propertyId, projectId });
      if (!res.ok) {
        // A contract on this award is the refusal that matters, and it says so.
        toast.error(res.error);
        return;
      }
      toast.success(`Award taken back from ${vendorName}`);
      router.refresh();
    });
  }

  if (mode === "invite") {
    return (
      <BidInviteWizard
        propertyId={propertyId}
        projectId={projectId}
        data={data}
        onClose={() => setMode("compare")}
      />
    );
  }
  if (mode === "manual") {
    return (
      <ManualBidPanel
        propertyId={propertyId}
        projectId={projectId}
        vendors={data.vendors}
        scopeItems={data.scopeItems}
        editingBidId={editingBidId}
        onClose={() => setMode("compare")}
      />
    );
  }
  if (mode === "agreement") {
    return (
      <AwardFromAgreementPanel
        propertyId={propertyId}
        projectId={projectId}
        agreements={data.rateAgreements}
        onClose={() => setMode("compare")}
      />
    );
  }

  const columns = data.bids.filter((b) => b.status !== "withdrawn");

  return (
    <div className="space-y-4">
      {scopeBlocker && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-gold/40 bg-gold/8 px-3.5 py-2.5">
          <p className="min-w-0 flex-1 text-[12.5px] text-ink-600">
            {scopeBlocker} — finish the scope before it goes out.
          </p>
          <Button size="sm" variant="outline" onClick={onEditScope}>
            Back to scope
          </Button>
        </div>
      )}

      <div className="flex justify-end gap-2">
        {/* Only when this unit's tier has a standing vendor rate sheet — the
            fast path past a fresh RFP or a hand-typed direct award. */}
        {data.rateAgreements.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            disabled={!!scopeBlocker}
            onClick={() => setMode("agreement")}
          >
            Award under agreement
          </Button>
        )}
        {/* For a bid that came in by phone or email instead of the portal. */}
        <Button size="sm" variant="outline" onClick={() => openManual()}>
          Record a bid manually
        </Button>
        <Button size="sm" disabled={!!scopeBlocker} onClick={() => setMode("invite")}>
          {columns.length > 0 ? "Invite more vendors" : "Send for pricing"}
        </Button>
      </div>

      {/* Only when there are no bids. A scope emptied after bids came back still
          shows them — an award there still holds committed cost and has to
          stay reachable to take back. */}
      {columns.length === 0 ? (
        <p className="rounded-card border border-dashed border-border px-4 py-8 text-center text-[13px] text-muted-foreground">
          Nothing out for pricing yet. Send the scope to vendors, or record a bid that came in by
          phone or email.
        </p>
      ) : (
        <BidMatrix
          propertyId={propertyId}
          projectId={projectId}
          data={data}
          columns={columns}
          pending={pending}
          onAward={award}
          onTakeBack={takeBack}
          onEdit={openManual}
        />
      )}
    </div>
  );
}

/** What one cell has to say. Never-asked and not-yet-answered are different facts. */
type Cell =
  | { kind: "not_asked" }
  | { kind: "awaiting" }
  | { kind: "no_bid" }
  | { kind: "price"; amount: number };

/**
 * Every vendor's price against every scope line, with each vendor's column
 * carrying its own status, actions and files.
 *
 * Which line each vendor is actually good at is the whole question when several
 * price the same scope, and it is also what makes a split award possible — Ace
 * for the countertops, Bolt for the millwork.
 */
function BidMatrix({
  propertyId,
  projectId,
  data,
  columns,
  pending,
  onAward,
  onTakeBack,
  onEdit,
}: {
  propertyId: number;
  projectId: number;
  data: BidPackageOption;
  columns: Bid[];
  pending: boolean;
  /** Awarding is the parent's job — it owns the transition and the refresh. */
  onAward: (bidId: number, vendorName: string, replace?: boolean) => void;
  onTakeBack: (bidId: number, vendorName: string) => void;
  onEdit: (bidId: number) => void;
}) {
  // The column whose "Award instead" is waiting on a second press — moving an
  // award un-awards somebody, so it asks once.
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const amountOf = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of data.lineAmounts) m.set(`${l.bidId}:${l.scopeItemId}`, l.amount);
    return m;
  }, [data.lineAmounts]);

  // Whether this bid's numbers are an answer yet.
  //
  // A portal request ('sent') is with the vendor until they submit — the portal
  // saves their prices as they type, so a number on an unsubmitted request is a
  // work in progress, not a quote. A hand-recorded bid ('draft') carries what
  // staff typed in, which is the answer itself whether or not a received date
  // was filled in. Anything submitted, received or awarded is answered.
  const hasPrice = (bid: Bid) => data.lineAmounts.some((l) => l.bidId === bid.id && l.amount > 0);
  const answered = (bid: Bid) =>
    !!bid.receivedDate || bid.approved || (bid.status === "draft" && hasPrice(bid));

  // Requests go out with every line seeded at zero, so an unanswered zero means
  // "not priced yet". Once answered, the portal stores a declined line as zero,
  // which is a real "no bid".
  const cellOf = (bid: Bid, lineId: number): Cell => {
    const v = amountOf.get(`${bid.id}:${lineId}`);
    if (v == null) return { kind: "not_asked" };
    if (!answered(bid)) return { kind: "awaiting" };
    return v > 0 ? { kind: "price", amount: v } : { kind: "no_bid" };
  };
  const linesPricedBy = (bid: Bid) =>
    data.scopeItems.filter((s) => {
      const c = cellOf(bid, s.id);
      return c.kind === "price" || c.kind === "no_bid";
    }).length;
  const totalFor = (bid: Bid) =>
    data.scopeItems.reduce((sum, s) => {
      const c = cellOf(bid, s.id);
      return sum + (c.kind === "price" ? c.amount : 0);
    }, 0);

  const estimateTotal = data.scopeItems.reduce((s, i) => s + (i.budgeted ?? 0), 0);

  // Who already holds each line, by the server's own coverage rule
  // (coveredLineIds). A vendor whose lines overlap an existing award gets the
  // replace confirmation rather than a plain Award the server would refuse.
  const holderOf = new Map<number, Bid>();
  for (const b of data.bids) {
    if (!b.approved) continue;
    for (const lineId of b.coveredLineIds) holderOf.set(lineId, b);
  }
  const overlapping = (bid: Bid): Bid[] => {
    const out = new Map<number, Bid>();
    for (const lineId of bid.coveredLineIds) {
      const h = holderOf.get(lineId);
      if (h && h.id !== bid.id) out.set(h.id, h);
    }
    return [...out.values()];
  };

  // The cheapest total is only meaningful among vendors who priced the WHOLE
  // scope. A vendor asked for one line will always look cheapest, and marking
  // it would be recommending less work rather than a better price.
  const fullCoverage =
    data.scopeItems.length === 0
      ? []
      : columns.filter((b) => answered(b) && linesPricedBy(b) === data.scopeItems.length);
  const bestBidId =
    fullCoverage.length > 1
      ? fullCoverage.reduce((best, b) => (totalFor(b) < totalFor(best) ? b : best)).id
      : null;

  // Sticky so the line names stay in view however many vendors are compared.
  const STICKY = "sticky left-0 z-10 bg-card";
  const VENDOR_COL = "min-w-[188px] border-l border-hairline px-3";

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-card border border-border">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-border">
              <th className={cn(STICKY, LABEL, "px-3 py-2.5 text-left align-bottom")}>
                Scope · {data.scopeItems.length} line{data.scopeItems.length === 1 ? "" : "s"}
              </th>
              <th className={cn(LABEL, "px-3 py-2.5 text-right align-bottom")}>Budget</th>
              {columns.map((b) => (
                <th
                  key={b.id}
                  className={cn(
                    VENDOR_COL,
                    "border-t-[3px] py-2.5 text-left align-top font-normal",
                    b.approved ? "border-t-positive bg-positive-bg/60" : "border-t-transparent",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 truncate text-[13px] font-semibold text-navy">
                      {b.vendorName ?? "Vendor removed"}
                    </div>
                    <BidMenu projectId={projectId} bid={b} disabled={pending} onEdit={onEdit} />
                  </div>
                  {/* The column's state and the award decision, on one line —
                      the award lives with the vendor it is about, so the
                      totals underneath can stay just numbers. */}
                  <div className="mt-1 flex min-h-6 flex-wrap items-center gap-x-2 gap-y-1">
                    {!b.approved && <StatusText bid={b} />}
                    {!b.approved && <VendorTrail progress={b.progress} submitted={answered(b)} />}
                    <AwardControl
                      bid={b}
                      canAward={answered(b) && linesPricedBy(b) > 0}
                      overlaps={overlapping(b)}
                      primary={b.id === bestBidId}
                      pending={pending}
                      confirming={confirmingId === b.id}
                      onConfirming={(on) => setConfirmingId(on ? b.id : null)}
                      onAward={onAward}
                      onTakeBack={onTakeBack}
                    />
                  </div>
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {data.scopeItems.map((line) => {
              const prices = columns
                .map((b) => cellOf(b, line.id))
                .flatMap((c) => (c.kind === "price" ? [c.amount] : []));
              const low = prices.length > 1 ? Math.min(...prices) : null;

              return (
                <tr key={line.id} className="border-b border-hairline">
                  <td className={cn(STICKY, "px-3 py-2.5")}>
                    <div className="text-[13px] font-medium text-navy">{line.item}</div>
                    {/* A unit turn's lines are named after their category, so
                        repeating it underneath is noise. */}
                    {line.costCodeName !== line.item && (
                      <div className="text-[10.5px] text-ink-300">
                        {line.costCodeName ?? "No budget category"}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink-400">
                    {line.budgeted != null ? money(line.budgeted) : "—"}
                  </td>
                  {columns.map((b) => (
                    <td
                      key={b.id}
                      className={cn(
                        VENDOR_COL,
                        "py-2.5 text-right tabular-nums",
                        // The awarded column reads as one band, top to bottom.
                        b.approved && "bg-positive-bg/60",
                      )}
                    >
                      <PriceCell cell={cellOf(b, line.id)} budget={line.budgeted} low={low} />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>

          <tfoot>
            <tr className="bg-band">
              <td className={cn(STICKY, "bg-band px-3 py-3 text-[10.5px] font-bold uppercase tracking-[0.09em] text-ink-500")}>
                Total
              </td>
              <td className="px-3 py-3 text-right text-[13px] font-bold tabular-nums text-ink-900">
                {estimateTotal > 0 ? money(estimateTotal) : "—"}
              </td>
              {columns.map((b) => {
                const total = totalFor(b);
                const covered = linesPricedBy(b);
                const isBest = b.id === bestBidId;
                const vsBudget =
                  answered(b) && estimateTotal > 0 && total > 0
                    ? Math.round(((total - estimateTotal) / estimateTotal) * 100)
                    : null;
                const versus =
                  covered < data.scopeItems.length
                    ? `${covered} of ${data.scopeItems.length} lines`
                    : vsBudget == null || vsBudget === 0
                      ? "on budget"
                      : `${vsBudget > 0 ? "+" : ""}${vsBudget}% vs budget`;
                return (
                  <td key={b.id} className={cn(VENDOR_COL, "py-3 text-right align-top")}>
                    {answered(b) ? (
                      <>
                        <div
                          className={cn(
                            "text-[14px] font-bold tabular-nums",
                            isBest ? "text-positive" : "text-ink-900",
                          )}
                        >
                          {total > 0 ? money(total) : "—"}
                        </div>
                        <div
                          className={cn(
                            "mt-0.5 text-[10.5px]",
                            isBest ? "font-semibold text-positive" : "text-ink-400",
                          )}
                        >
                          {isBest ? `Best price · ${versus}` : versus}
                        </div>
                      </>
                    ) : (
                      <div className="text-[12px] italic text-ink-300">Awaiting response</div>
                    )}
                  </td>
                );
              })}
            </tr>

            <tr className="border-t border-hairline">
              <td className={cn(STICKY, LABEL, "px-3 py-2.5 align-top")}>Files</td>
              <td />
              {columns.map((b) => (
                <td key={b.id} className={cn(VENDOR_COL, "py-2 align-top")}>
                  <BidAttachments
                    propertyId={propertyId}
                    projectId={projectId}
                    bidId={b.id}
                    attachments={b.attachments}
                    archivedAttachments={b.archivedAttachments}
                  />
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Awarding covers every line that vendor priced, so vendors on different lines can both be
        awarded. Best price is only marked among vendors who priced the whole scope.
      </p>
    </div>
  );
}

/**
 * The award, for one vendor's column: award it, take it back, or move it here
 * from whoever holds these lines now.
 *
 * Moving an award un-awards somebody, so it asks once — the button turns into
 * a confirmation naming who loses the work. Taking an award back does not ask:
 * it is undone by awarding again. Either is refused by the server while the
 * award being undone has a contract, and the toast says so.
 */
function AwardControl({
  bid,
  canAward,
  overlaps,
  primary,
  pending,
  confirming,
  onConfirming,
  onAward,
  onTakeBack,
}: {
  bid: Bid;
  canAward: boolean;
  /** Awards that already hold some of the lines this bid priced. */
  overlaps: Bid[];
  primary: boolean;
  pending: boolean;
  confirming: boolean;
  onConfirming: (on: boolean) => void;
  onAward: (bidId: number, vendorName: string, replace?: boolean) => void;
  onTakeBack: (bidId: number, vendorName: string) => void;
}) {
  const name = bid.vendorName ?? "this vendor";

  if (bid.approved) {
    return (
      <>
        <span className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-[0.05em] text-positive">
          <CheckIcon className="size-3.5" />
          Awarded
        </span>
        <button
          type="button"
          disabled={pending}
          className="text-[11.5px] text-muted-foreground underline underline-offset-2 hover:text-alert disabled:opacity-50"
          onClick={() => onTakeBack(bid.id, name)}
        >
          Take back
        </button>
      </>
    );
  }

  if (!canAward) return null;

  const others = overlaps.map((o) => o.vendorName ?? "another vendor").join(" and ");
  if (confirming) {
    return (
      <span className="flex items-center gap-1.5">
        <Button
          size="xs"
          variant="destructive"
          disabled={pending}
          onClick={() => {
            onConfirming(false);
            onAward(bid.id, name, true);
          }}
        >
          Replace {others}
        </Button>
        <button
          type="button"
          className="text-[11.5px] text-muted-foreground hover:underline"
          onClick={() => onConfirming(false)}
        >
          Cancel
        </button>
      </span>
    );
  }
  return (
    <Button
      size="xs"
      variant={primary && overlaps.length === 0 ? "default" : "outline"}
      disabled={pending}
      // Overlapping lines mean this replaces an award, which asks first; the
      // tooltip says whose before the second press does.
      title={overlaps.length > 0 ? `Lines held by ${others}` : undefined}
      onClick={() => (overlaps.length > 0 ? onConfirming(true) : onAward(bid.id, name))}
    >
      Award
    </Button>
  );
}

/** One price, highlighted when it is the lowest on its line, with its distance from budget. */
function PriceCell({
  cell,
  budget,
  low,
}: {
  cell: Cell;
  budget: number | null;
  /** The lowest price on this line — null when fewer than two vendors priced it. */
  low: number | null;
}) {
  if (cell.kind === "not_asked") {
    return (
      <span className="text-ink-200" title="This vendor was not asked to price this line">
        —
      </span>
    );
  }
  if (cell.kind === "awaiting") {
    return <span className="text-[11.5px] italic text-ink-300">awaiting</span>;
  }
  if (cell.kind === "no_bid") {
    return <span className="text-[11.5px] italic text-ink-400">no bid</span>;
  }

  const isLow = low != null && cell.amount === low;
  // Against a line with no budget the "difference" is just the price again.
  const delta = budget != null && budget > 0 ? cell.amount - budget : null;
  return (
    <span
      className={cn(
        "inline-block rounded px-1.5 py-0.5 text-right",
        isLow && "bg-positive-bg",
      )}
    >
      <span className={cn("block text-[13px]", isLow ? "font-bold text-positive" : "text-ink-700")}>
        {money(cell.amount)}
      </span>
      {delta != null && delta !== 0 && (
        <span className={cn("block text-[10px]", delta > 0 ? "text-alert" : "text-positive")}>
          {delta > 0 ? "+" : "−"}
          {money(Math.abs(delta))}
        </span>
      )}
    </span>
  );
}

/**
 * Where an undecided bid stands, in a few words. Plain text rather than a pill:
 * the award beside it is the one thing in the header that should stand out.
 */
function StatusText({ bid }: { bid: Bid }) {
  const [label, tone] = bid.receivedDate
    ? [`Back ${fmtDate(bid.receivedDate)}`, "text-ink-400"]
    : bid.status === "sent"
      ? [bid.sentAt ? `Sent ${fmtDate(bid.sentAt)}` : "Sent", "text-ink-400"]
      : bid.status === "declined"
        ? ["Declined", "text-ink-300"]
        : bid.status === "draft"
          ? ["Not sent", "font-medium text-[#7a6414]"]
          : [bid.status, "text-ink-400"];
  return <span className={cn("text-[11px]", tone)}>{label}</span>;
}

/**
 * One vendor's actions, behind the column's ⋯.
 *
 * Copying puts a URL on the clipboard that anyone holding it can price with.
 * Reissuing revokes the previous link, which is the way to kill one that went
 * to the wrong address. A decided bid has nothing left for the vendor to do, so
 * the link actions go away once it is awarded or declined.
 */
function BidMenu({
  projectId,
  bid,
  disabled,
  onEdit,
}: {
  projectId: number;
  bid: Bid;
  disabled: boolean;
  onEdit: (bidId: number) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const linkable = !bid.approved && bid.status !== "declined";

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

  function revoke() {
    startTransition(async () => {
      const res = await revokeLink({ bidId: bid.id, projectId });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Link revoked");
      router.refresh();
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled || pending}
        render={<Button variant="ghost" size="icon-sm" className="-mr-1.5 -mt-1 shrink-0" />}
      >
        <EllipsisIcon />
        <span className="sr-only">Actions for {bid.vendorName ?? "this bid"}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuItem onClick={() => onEdit(bid.id)}>Edit bid</DropdownMenuItem>
        {linkable &&
          (bid.token ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => copy(bid.token!)}>Copy vendor link</DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => window.open(`/bid/${bid.token}?preview=1`, "_blank", "noreferrer")}
              >
                View as vendor
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => mint(true)}>Reissue link</DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onClick={revoke}>
                Revoke link
              </DropdownMenuItem>
            </>
          ) : (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => mint(false)}>Get vendor link</DropdownMenuItem>
            </>
          ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * How far one vendor has got, in a few words.
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
  if (progress.startedPricing) parts.push("pricing");
  else if (progress.lastSeenAt) parts.push(progress.opens > 1 ? `opened ${progress.opens}×` : "opened");
  else if (progress.invitedAt) parts.push("not opened");
  if (progress.lastSeenAt) parts.push(ago(progress.lastSeenAt));
  if (parts.length === 0) return null;

  return (
    <span
      className={cn(
        "text-[10.5px] leading-tight",
        progress.startedPricing ? "text-positive" : progress.lastSeenAt ? "text-ink-400" : "text-gold",
      )}
    >
      {parts.join(" · ")}
    </span>
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

"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveBidDraft, submitBidPrices } from "@/lib/actions/bid-portal";
import type { PortalBid } from "@/lib/bid-portal";

const usd = (n: number) =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * What a vendor fills in.
 *
 * Deliberately plain: a contractor opening this on a phone in a truck should see
 * a list of work and a box per line, with a running total they can sanity-check
 * before submitting. No app chrome, no navigation, nothing to get lost in.
 */
export function BidPortalForm({ token, bid }: { token: string; bid: PortalBid }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [amounts, setAmounts] = useState<Record<number, string>>(() =>
    Object.fromEntries(bid.lines.map((l) => [l.id, l.amount > 0 ? String(l.amount) : ""])),
  );
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saving, setSaving] = useState(false);

  const parsed = bid.lines.map((l) => ({ id: l.id, value: Number(amounts[l.id] ?? "") }));

  /**
   * Keep what has been typed, without submitting it.
   *
   * A bid used to be all or nothing: fill in fifteen lines in one sitting or
   * lose them. A contractor pricing between site visits needs to come back to
   * it. Debounced rather than saved per keystroke, and it never submits — a
   * draft must not look like an answer on our side.
   */
  const saveDraft = useCallback(
    (next: Record<number, string>) => {
      if (bid.submitted) return;
      const payload = bid.lines
        .map((l) => ({ lineId: l.id, amount: Number(next[l.id] ?? "") }))
        .filter((a) => Number.isFinite(a.amount) && a.amount >= 0);
      if (payload.length === 0) return;

      setSaving(true);
      void saveBidDraft({ token, amounts: payload })
        .then((res) => {
          if (res.ok) setSavedAt(new Date());
        })
        .finally(() => setSaving(false));
    },
    [bid.lines, bid.submitted, token],
  );

  // One timer for the whole form, reset on every change, so a vendor tabbing
  // down fifteen boxes writes once rather than fifteen times.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  function setAmount(lineId: number, value: string) {
    const next = { ...amounts, [lineId]: value };
    setAmounts(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => saveDraft(next), 1200);
  }

  const filled = parsed.filter((p) => Number.isFinite(p.value) && p.value > 0);
  const invalid = parsed.some((p) => amounts[p.id] !== "" && (!Number.isFinite(p.value) || p.value < 0));
  const total = filled.reduce((n, p) => n + p.value, 0);
  const blanks = bid.lines.length - filled.length;

  function submit() {
    startTransition(async () => {
      const res = await submitBidPrices({
        token,
        // Blank lines are sent as zero rather than omitted, so a line the vendor
        // chose not to price reads as zero rather than as never asked.
        amounts: parsed.map((p) => ({
          lineId: p.id,
          amount: Number.isFinite(p.value) ? p.value : 0,
        })),
        note: note || undefined,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Bid submitted");
      setConfirming(false);
      router.refresh();
    });
  }

  if (bid.submitted) {
    return (
      <div className="rounded-card border border-positive/30 bg-positive-bg p-4">
        <p className="text-[15px] font-semibold text-positive">Bid submitted</p>
        <p className="mt-1 text-[13px] text-ink-700">
          Thank you. {bid.propertyName} has your pricing for {bid.projectName}. If something needs
          changing, contact them and they can reopen it.
        </p>
        <dl className="mt-3 border-t border-positive/20 pt-3">
          {bid.lines.map((l) => (
            <div key={l.id} className="flex justify-between gap-4 py-1 text-[13px]">
              <dt className="min-w-0 flex-1 text-ink-700">{l.description}</dt>
              <dd className="shrink-0 tabular-nums text-ink-700">{usd(l.amount)}</dd>
            </div>
          ))}
          <div className="mt-1 flex justify-between gap-4 border-t border-positive/20 pt-2 text-[15px] font-semibold">
            <dt>Total</dt>
            <dd className="tabular-nums">{usd(bid.lines.reduce((n, l) => n + l.amount, 0))}</dd>
          </div>
        </dl>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="divide-y divide-hairline rounded-card border border-border bg-card">
        {bid.lines.map((l, i) => (
          <div key={l.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <span className="w-6 shrink-0 text-[11px] tabular-nums text-ink-300">{i + 1}</span>
            <label htmlFor={`line-${l.id}`} className="min-w-0 flex-1 text-[14px] text-ink-700">
              {l.description}
            </label>
            <div className="flex shrink-0 items-center gap-1.5">
              <span className="text-[13px] text-ink-300">$</span>
              <Input
                id={`line-${l.id}`}
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                placeholder="0.00"
                className="h-9 w-28 text-right tabular-nums"
                value={amounts[l.id] ?? ""}
                disabled={pending}
                onChange={(e) => setAmount(l.id, e.target.value)}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-1.5">
        <label htmlFor="bid-note" className="text-[13px] font-medium text-ink-700">
          Notes (optional)
        </label>
        <textarea
          id="bid-note"
          rows={3}
          value={note}
          disabled={pending}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Exclusions, lead times, assumptions…"
          className="w-full rounded-control border border-input bg-card px-3 py-2 text-[14px] outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-muted/30 px-4 py-3">
        <div className="text-[13px] text-ink-500">
          {invalid ? (
            <span className="text-alert">Enter a number of zero or more on every line you price.</span>
          ) : blanks > 0 ? (
            <>
              {blanks} of {bid.lines.length} line{blanks === 1 ? "" : "s"} not priced — they will be
              submitted as zero.
            </>
          ) : (
            <>All {bid.lines.length} lines priced.</>
          )}
        </div>
        <div className="flex items-center gap-3">
          {/* Says the work is safe without making a fuss of it. A vendor who
              closes the tab mid-price should already know it was kept. */}
          <span className="text-[11.5px] text-ink-300">
            {saving
              ? "Saving…"
              : savedAt
                ? `Saved ${savedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
                : "Your prices are saved as you type"}
          </span>
          <span className="text-[17px] font-semibold tabular-nums text-navy">{usd(total)}</span>
          {confirming ? (
            <>
              <Button variant="ghost" disabled={pending} onClick={() => setConfirming(false)}>
                Back
              </Button>
              <Button disabled={pending} onClick={submit}>
                {pending ? "Submitting…" : `Confirm ${usd(total)}`}
              </Button>
            </>
          ) : (
            <Button disabled={pending || invalid || total <= 0} onClick={() => setConfirming(true)}>
              Submit bid
            </Button>
          )}
        </div>
      </div>

      {confirming && (
        // A second press before it locks: submitting is one-way for the vendor,
        // and a fat-fingered total is the mistake most worth catching.
        <p className="text-[12px] text-muted-foreground">
          Submitting sends {usd(total)} to {bid.propertyName}. You will not be able to change it
          afterwards without asking them to reopen it.
        </p>
      )}
    </div>
  );
}

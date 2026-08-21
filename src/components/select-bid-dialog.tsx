"use client";

import { useState, useTransition } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { fmtDate, money } from "@/lib/format";
import { sendBidPackage } from "@/lib/actions/bid-package";
import { createVendor } from "@/lib/actions/vendors";
import { issueLink, revokeLink } from "@/lib/actions/bid-portal";
import type { BidPackageOption } from "@/lib/bid-package";

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
  projectId,
  data,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
  data: BidPackageOption;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [addingVendor, setAddingVendor] = useState(false);

  // All scope items by default — sending a partial package is the exception.
  const [items, setItems] = useState<Set<number>>(
    () => new Set(data.scopeItems.map((s) => s.id)),
  );
  const [vendors, setVendors] = useState<Set<number>>(new Set());

  const outAlready = new Set(
    data.bids.filter((b) => LIVE.has(b.status)).map((b) => b.vendorId).filter((v): v is number => v != null),
  );
  const sendable = data.vendors.filter((v) => !outAlready.has(v.id));

  function send() {
    startTransition(async () => {
      const res = await sendBidPackage({
        projectId,
        vendorIds: [...vendors],
        scopeItemIds: [...items],
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        res.skipped > 0
          ? `Sent to ${res.sent} — ${res.skipped} already had a live request`
          : `Sent to ${res.sent} vendor${res.sent === 1 ? "" : "s"}`,
      );
      setVendors(new Set());
      router.refresh();
    });
  }

  function addVendor(form: HTMLFormElement) {
    const fd = new FormData(form);
    startTransition(async () => {
      const res = await createVendor(fd);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      // Pre-select the vendor just added — you added it in order to send to it.
      setVendors((v) => new Set(v).add(res.vendorId));
      setAddingVendor(false);
      form.reset();
      toast.success("Vendor added");
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

        <div className="max-h-[70vh] space-y-5 overflow-y-auto">
          {/* ---------- what has come back ---------- */}
          {data.bids.length > 0 && (
            <div className="space-y-2">
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-ink-300">
                Out and returned
              </span>
              <div className="divide-y divide-hairline rounded-card border border-border">
                {data.bids.map((b) => (
                  <div key={b.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                    <span className="min-w-0 flex-1 text-[13px] font-medium text-navy">
                      {b.vendorName ?? "Vendor removed"}
                    </span>
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.09em]",
                        b.approved
                          ? "bg-positive/10 text-positive"
                          : LIVE.has(b.status)
                            ? "bg-pending/10 text-pending"
                            : "bg-muted text-ink-500",
                      )}
                    >
                      {b.approved ? "awarded" : b.status}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {b.sentAt ? `sent ${fmtDate(b.sentAt)}` : "not sent"}
                      {b.receivedDate ? ` · back ${fmtDate(b.receivedDate)}` : ""}
                      {` · ${b.lineCount} line${b.lineCount === 1 ? "" : "s"}`}
                    </span>
                    <span className="w-24 text-right text-[13px] font-semibold tabular-nums text-navy">
                      {b.total > 0 ? money(b.total) : "—"}
                    </span>
                    <BidLink projectId={projectId} bid={b} disabled={pending} />
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">
                A request with every line at zero is still out for pricing. Comparing and awarding
                comes next.
              </p>
            </div>
          )}

          {/* ---------- scope to send ---------- */}
          <div className="space-y-2 border-t border-border pt-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-ink-300">
                Scope to price · {items.size} of {data.scopeItems.length}
              </span>
              <button
                type="button"
                className="text-[11px] text-link hover:underline"
                onClick={() =>
                  setItems((s) =>
                    s.size === data.scopeItems.length
                      ? new Set()
                      : new Set(data.scopeItems.map((x) => x.id)),
                  )
                }
              >
                {items.size === data.scopeItems.length ? "Clear all" : "Select all"}
              </button>
            </div>
            {data.scopeItems.length === 0 ? (
              <p className="rounded-card border border-border bg-muted/30 px-3 py-3 text-[13px] text-muted-foreground">
                No scope yet — define the scope first and it becomes what you send out.
              </p>
            ) : (
              <div className="max-h-48 divide-y divide-hairline overflow-y-auto rounded-card border border-border">
                {data.scopeItems.map((s) => (
                  <label
                    key={s.id}
                    className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 hover:bg-track"
                  >
                    <input
                      type="checkbox"
                      className="size-3.5 accent-navy"
                      checked={items.has(s.id)}
                      disabled={pending}
                      onChange={(e) =>
                        setItems((p) => {
                          const n = new Set(p);
                          if (e.target.checked) n.add(s.id);
                          else n.delete(s.id);
                          return n;
                        })
                      }
                    />
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink-700">{s.item}</span>
                    {s.costCodeName && (
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {s.costCodeName}
                      </span>
                    )}
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* ---------- who to send to ---------- */}
          <div className="space-y-2 border-t border-border pt-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-ink-300">
                Send to · {vendors.size} selected
              </span>
              <button
                type="button"
                className="text-[11px] text-link hover:underline"
                onClick={() => setAddingVendor((v) => !v)}
              >
                {addingVendor ? "Cancel" : "+ New vendor"}
              </button>
            </div>

            {addingVendor && (
              <form
                className="space-y-2 rounded-card border border-border p-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  addVendor(e.currentTarget);
                }}
              >
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="bv-name" className="text-[11px]">
                      Vendor name
                    </Label>
                    <Input id="bv-name" name="name" required className="h-8 text-xs" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="bv-trade" className="text-[11px]">
                      Trade
                    </Label>
                    <Input id="bv-trade" name="trade" className="h-8 text-xs" placeholder="General" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="bv-contact" className="text-[11px]">
                      Contact name
                    </Label>
                    <Input id="bv-contact" name="contactName" className="h-8 text-xs" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="bv-email" className="text-[11px]">
                      Contact email
                    </Label>
                    <Input id="bv-email" name="contactEmail" type="email" className="h-8 text-xs" />
                  </div>
                </div>
                <div className="flex justify-end">
                  <Button type="submit" size="sm" disabled={pending}>
                    Add vendor
                  </Button>
                </div>
              </form>
            )}

            {sendable.length === 0 ? (
              <p className="rounded-card border border-border bg-muted/30 px-3 py-3 text-[13px] text-muted-foreground">
                {data.vendors.length === 0
                  ? "No vendors on the roster yet — add one above."
                  : "Every active vendor already has a live request on this project."}
              </p>
            ) : (
              <div className="max-h-48 divide-y divide-hairline overflow-y-auto rounded-card border border-border">
                {sendable.map((v) => (
                  <label
                    key={v.id}
                    className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 hover:bg-track"
                  >
                    <input
                      type="checkbox"
                      className="size-3.5 accent-navy"
                      checked={vendors.has(v.id)}
                      disabled={pending}
                      onChange={(e) =>
                        setVendors((p) => {
                          const n = new Set(p);
                          if (e.target.checked) n.add(v.id);
                          else n.delete(v.id);
                          return n;
                        })
                      }
                    />
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink-700">{v.name}</span>
                    {v.trade && (
                      <span className="shrink-0 text-[11px] text-muted-foreground">{v.trade}</span>
                    )}
                    {v.contactCount === 0 && (
                      <span
                        className="shrink-0 text-[10.5px] uppercase tracking-[0.09em] text-alert"
                        title="No contact on file — you will have nobody to send the link to"
                      >
                        no contact
                      </span>
                    )}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
          <span className="text-[11px] text-muted-foreground">
            {vendors.size > 0 && items.size > 0
              ? `${items.size} line${items.size === 1 ? "" : "s"} to ${vendors.size} vendor${vendors.size === 1 ? "" : "s"}`
              : "Pick scope and at least one vendor"}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" disabled={pending} onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button disabled={pending || vendors.size === 0 || items.size === 0} onClick={send}>
              {pending ? "Sending…" : "Send for pricing"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

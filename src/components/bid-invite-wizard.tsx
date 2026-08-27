"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckIcon, CopyIcon, TriangleAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { money } from "@/lib/format";
import {
  previewBidInvitation,
  sendBidInvitations,
  type InvitationOutcome,
  type InvitationPreview,
} from "@/lib/actions/bid-invitations";
import { createVendor } from "@/lib/actions/vendors";
import type { BidPackageOption } from "@/lib/bid-package";

const LABEL = "text-[9.5px] font-bold uppercase tracking-[0.1em] text-ink-300";

const STEPS = ["Scope", "Vendors", "Preview", "Send"] as const;

/**
 * Sending a scope out, one decision at a time.
 *
 * It was a single screen with two lists and a button, and the button did three
 * things nobody could see: created the requests, and — separately, later, by
 * hand — minted a link and had somebody paste it into Outlook. Splitting it into
 * steps is not ceremony; it is so the invitation can be READ before it goes,
 * which was never possible when no invitation existed.
 */
export function BidInviteWizard({
  propertyId,
  projectId,
  data,
  onClose,
}: {
  propertyId: number;
  projectId: number;
  data: BidPackageOption;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [step, setStep] = useState(0);

  const [items, setItems] = useState<Set<number>>(
    () => new Set(data.scopeItems.map((s) => s.id)),
  );
  const [vendors, setVendors] = useState<Set<number>>(new Set());
  const [dueDate, setDueDate] = useState("");
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [outcomes, setOutcomes] = useState<InvitationOutcome[] | null>(null);
  const [addingVendor, setAddingVendor] = useState(false);

  const chosenScope = data.scopeItems.filter((s) => items.has(s.id));
  const scopeTotal = chosenScope.reduce((n, s) => n + (s.budgeted ?? 0), 0);
  const chosenVendors = data.vendors.filter((v) => vendors.has(v.id));
  const noEmail = chosenVendors.filter((v) => !v.contactEmail);

  // The preview is rendered by the same code that sends, so it is fetched rather
  // than approximated — and refreshed whenever what it would say changes.
  useEffect(() => {
    if (step !== 2 || chosenVendors.length === 0) return;
    let live = true;
    void (async () => {
      const res = await previewBidInvitation({
        projectId,
        vendorId: chosenVendors[0].id,
        scopeItemIds: [...items],
        dueDate: dueDate || null,
      });
      if (live) setPreview(res.ok ? res.preview : null);
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, projectId, dueDate, items.size, vendors.size]);

  function addVendor(form: HTMLFormElement) {
    const fd = new FormData(form);
    startTransition(async () => {
      const res = await createVendor(fd);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      // Pre-selected, because you added it in order to send to it.
      setVendors((v) => new Set(v).add(res.vendorId));
      setAddingVendor(false);
      form.reset();
      toast.success("Vendor added");
      router.refresh();
    });
  }

  function send() {
    startTransition(async () => {
      const res = await sendBidInvitations({
        propertyId,
        projectId,
        vendorIds: [...vendors],
        scopeItemIds: [...items],
        dueDate: dueDate || null,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setOutcomes(res.outcomes);
      setStep(3);
      router.refresh();
    });
  }

  const canNext =
    step === 0 ? items.size > 0 : step === 1 ? vendors.size > 0 : true;

  return (
    <div className="flex flex-col">
      {/* ------------------------------------------------------- step rail */}
      <div className="flex gap-1 border-b border-border px-1 pb-3">
        {STEPS.map((s, i) => (
          <div
            key={s}
            className={cn(
              "flex flex-1 items-center gap-2 text-[11px]",
              i === step ? "font-semibold text-navy" : i < step ? "text-ink-500" : "text-ink-300",
            )}
          >
            <span
              className={cn(
                "flex size-[19px] shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
                i === step
                  ? "bg-navy text-white"
                  : i < step
                    ? "bg-positive text-white"
                    : "bg-hairline text-ink-400",
              )}
            >
              {i < step ? "✓" : i + 1}
            </span>
            {s}
          </div>
        ))}
      </div>

      <div className="min-h-[260px] py-4">
        {/* ------------------------------------------------------ 1. scope */}
        {step === 0 && (
          <>
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <h3 className="text-[15px] font-semibold text-navy">
                What scope would you like sent for bid?
              </h3>
              <button
                type="button"
                className="text-[11.5px] text-link hover:underline"
                onClick={() =>
                  setItems(
                    items.size === data.scopeItems.length
                      ? new Set()
                      : new Set(data.scopeItems.map((s) => s.id)),
                  )
                }
              >
                {items.size === data.scopeItems.length ? "Clear all" : "Select all"}
              </button>
            </div>
            <p className="mb-3 text-[12.5px] text-ink-400">
              Vendors price only the lines you pick. Sending a trade its own slice is what lets two
              vendors both be awarded later.
            </p>
            <div className="divide-y divide-hairline rounded-card border border-border">
              {data.scopeItems.map((s) => (
                <label
                  key={s.id}
                  className="flex cursor-pointer items-center gap-3 px-3 py-2 text-[13px] hover:bg-hover"
                >
                  <input
                    type="checkbox"
                    className="size-4 accent-navy"
                    checked={items.has(s.id)}
                    onChange={() => {
                      const next = new Set(items);
                      if (next.has(s.id)) next.delete(s.id);
                      else next.add(s.id);
                      setItems(next);
                    }}
                  />
                  <span className="min-w-0 flex-1 truncate text-navy">{s.item}</span>
                  <span className="text-[11px] text-ink-400">
                    {s.costCodeName ?? "No category"}
                    {s.budgeted != null ? ` · ${money(s.budgeted)}` : ""}
                  </span>
                </label>
              ))}
            </div>
          </>
        )}

        {/* ---------------------------------------------------- 2. vendors */}
        {step === 1 && (
          <>
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <h3 className="text-[15px] font-semibold text-navy">Who should price it?</h3>
              <button
                type="button"
                className="text-[11.5px] text-link hover:underline"
                onClick={() => setAddingVendor((v) => !v)}
              >
                {addingVendor ? "Cancel" : "+ New vendor"}
              </button>
            </div>
            <p className="mb-3 text-[12.5px] text-ink-400">
              Each vendor gets its own copy and its own private link. Nobody sees anyone else&apos;s
              numbers.
            </p>
            <div className="divide-y divide-hairline rounded-card border border-border">
              {data.vendors.map((v) => (
                <label
                  key={v.id}
                  className="flex cursor-pointer items-center gap-3 px-3 py-2 text-[13px] hover:bg-hover"
                >
                  <input
                    type="checkbox"
                    className="size-4 accent-navy"
                    checked={vendors.has(v.id)}
                    onChange={() => {
                      const next = new Set(vendors);
                      if (next.has(v.id)) next.delete(v.id);
                      else next.add(v.id);
                      setVendors(next);
                    }}
                  />
                  <span className="min-w-0 flex-1 truncate text-navy">{v.name}</span>
                  {v.contactEmail ? (
                    <span className="truncate text-[11px] text-ink-400">
                      {v.trade ? `${v.trade} · ` : ""}
                      {v.contactEmail}
                    </span>
                  ) : (
                    // Selectable, because the request and its link are still real
                    // — but it cannot be mailed, and that should be visible now
                    // rather than discovered on the last screen.
                    <span className="flex items-center gap-1 text-[11px] font-semibold text-gold">
                      <TriangleAlertIcon className="size-3" />
                      no email on file
                    </span>
                  )}
                </label>
              ))}
            </div>

            {addingVendor && (
              // The contact email is on this form rather than buried in the
              // vendor record, because a vendor added here is added in order to
              // be emailed, and one without an address cannot be.
              <form
                className="mt-3 grid grid-cols-2 gap-2 rounded-card border border-border bg-muted/40 p-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  addVendor(e.currentTarget);
                }}
              >
                <Input name="name" placeholder="Vendor name" required className="h-8 text-sm" />
                <Input name="trade" placeholder="Trade (optional)" className="h-8 text-sm" />
                <Input name="contactName" placeholder="Contact name" className="h-8 text-sm" />
                <Input
                  name="contactEmail"
                  type="email"
                  placeholder="Contact email"
                  className="h-8 text-sm"
                />
                <div className="col-span-2 flex justify-end">
                  <Button size="sm" type="submit" disabled={pending}>
                    Add vendor
                  </Button>
                </div>
              </form>
            )}

            <div className="mt-4 max-w-[220px]">
              <Label className={LABEL} htmlFor="bid-due">
                Respond by (optional)
              </Label>
              <Input
                id="bid-due"
                type="date"
                className="mt-1.5 h-8 text-sm"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </>
        )}

        {/* ---------------------------------------------------- 3. preview */}
        {step === 2 && (
          <>
            <h3 className="mb-2 text-[15px] font-semibold text-navy">Preview the invitation</h3>
            <p className="mb-3 text-[12.5px] text-ink-400">
              This is what each vendor receives. The link inside it is unique to them.
            </p>

            <div className="overflow-hidden rounded-card border border-border">
              <div className="border-b border-border bg-muted px-3 py-2 text-[11.5px]">
                <div>
                  <span className="font-semibold text-ink-700">Subject:</span>{" "}
                  {preview?.subject ?? "…"}
                </div>
                <div className="mt-0.5 text-ink-400">
                  <span className="font-semibold text-ink-700">To:</span>{" "}
                  {chosenVendors.map((v) => v.contactEmail ?? `${v.name} (no email)`).join(", ")}
                  {chosenVendors.length > 1 && ` · ${chosenVendors.length} separate emails`}
                </div>
              </div>
              {preview ? (
                // An iframe, so the email's own styles cannot leak into the app
                // and the app's cannot flatter the email.
                <iframe
                  title="Invitation preview"
                  srcDoc={preview.html}
                  className="h-[300px] w-full bg-[#f4f5f7]"
                />
              ) : (
                <p className="px-3 py-8 text-center text-[12.5px] text-ink-300">
                  Rendering the invitation…
                </p>
              )}
            </div>

            {noEmail.length > 0 && (
              <p className="mt-2.5 text-[11.5px] text-gold">
                {noEmail.map((v) => v.name).join(", ")} {noEmail.length === 1 ? "has" : "have"} no
                contact email. The request and link are still created — you will be given the link to
                pass on.
              </p>
            )}
          </>
        )}

        {/* ------------------------------------------------------- 4. sent */}
        {step === 3 && outcomes && (
          <>
            <div className="py-4 text-center">
              <div className="mx-auto flex size-11 items-center justify-center rounded-full bg-positive-bg text-positive">
                <CheckIcon className="size-5" />
              </div>
              <h3 className="mt-2.5 text-[15px] font-semibold text-navy">
                {outcomes.filter((o) => o.status !== "skipped").length} request
                {outcomes.filter((o) => o.status !== "skipped").length === 1 ? "" : "s"} created
              </h3>
              <p className="mt-1 text-[12.5px] text-ink-400">
                The scope is locked while they price it. Withdraw the requests to edit it again.
              </p>
            </div>

            <div className="divide-y divide-hairline rounded-card border border-border">
              {outcomes.map((o) => (
                <div key={o.vendorId} className="flex items-center gap-3 px-3 py-2 text-[13px]">
                  <span
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      o.status === "sent"
                        ? "bg-positive"
                        : o.status === "failed"
                          ? "bg-alert"
                          : "bg-gold",
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate text-navy">{o.vendorName}</span>
                  <span className="truncate text-[11px] text-ink-400">
                    {o.status === "sent" && `emailed ${o.email}`}
                    {o.status === "not_configured" && "link ready — email not configured"}
                    {o.status === "no_email" && "link ready — no contact email"}
                    {o.status === "failed" && (o.detail ?? "send failed")}
                    {o.status === "skipped" && (o.detail ?? "skipped")}
                  </span>
                  {o.link && (
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => {
                        void navigator.clipboard.writeText(o.link!);
                        toast.success(`Link for ${o.vendorName} copied`);
                      }}
                    >
                      <CopyIcon className="size-3" />
                      Copy link
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ----------------------------------------------------------- footer */}
      <div className="flex items-center gap-2 border-t border-border pt-3">
        <span className="mr-auto text-[11.5px] text-ink-400">
          {step === 0 && scopeTotal > 0 && `${money(scopeTotal)} of scope selected`}
          {step === 1 && "A vendor with no contact email cannot be emailed."}
          {step === 2 && "Nothing has been sent yet."}
          {step === 3 && "Bids appear on the comparison as they come back."}
        </span>

        {step === 3 ? (
          <Button size="sm" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => (step === 0 ? onClose() : setStep(step - 1))}
            >
              {step === 0 ? "Cancel" : "Back"}
            </Button>
            {step === 2 ? (
              <Button size="sm" disabled={pending} onClick={send}>
                Send to {chosenVendors.length} vendor{chosenVendors.length === 1 ? "" : "s"}
              </Button>
            ) : (
              <Button size="sm" disabled={!canNext || pending} onClick={() => setStep(step + 1)}>
                Next: {STEPS[step + 1].toLowerCase()}
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

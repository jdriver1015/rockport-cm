"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PlusIcon, TrashIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { moneyExact, num } from "@/lib/format";
import { addBid, editBid, getBidDetail } from "@/lib/actions/bids";
import type { BidPackageOption } from "@/lib/bid-package";

// Working line in the form: a scope line is locked (description = scope item,
// not removable) so the priced lines always match what is actually in scope;
// a manual line is free-form and removable, for labor or anything else a
// vendor quoted that isn't its own scope item.
type FormLine = {
  key: string;
  scopeItemId: number | null;
  description: string;
  amount: string;
  locked: boolean;
};

type ExistingLine = { scopeItemId: number | null; description: string; amount: string };

function buildLines(
  scopeItems: BidPackageOption["scopeItems"],
  existing: ExistingLine[],
): FormLine[] {
  const byScope = new Map<number, ExistingLine>();
  const manual: ExistingLine[] = [];
  for (const l of existing) {
    if (l.scopeItemId !== null && scopeItems.some((s) => s.id === l.scopeItemId)) {
      byScope.set(l.scopeItemId, l);
    } else {
      manual.push(l);
    }
  }

  const scopeLines: FormLine[] = scopeItems.map((s) => {
    const line = byScope.get(s.id);
    return {
      key: `scope-${s.id}`,
      scopeItemId: s.id,
      description: s.item,
      amount: line ? line.amount : "",
      locked: true,
    };
  });

  const manualLines: FormLine[] = manual.map((l, i) => ({
    key: `manual-${i}`,
    scopeItemId: null,
    description: l.description,
    amount: l.amount,
    locked: false,
  }));

  return [...scopeLines, ...manualLines];
}

/**
 * Record a bid by hand.
 *
 * The RFP portal is the normal path — a vendor prices the scope themselves and
 * it lands here already — but a bid that came in by phone or email has to get
 * into the same table by some other door, or it can never be awarded, never
 * gets a contract, and has nowhere to attach the PDF it arrived as. This is
 * that door. It writes through the same addBid/editBid actions a portal
 * submission would eventually flow through, so awarding, coverage, and
 * everything downstream treats a manual bid exactly like any other.
 *
 * Inline in the parent's dialog rather than a dialog of its own — same
 * reasoning as BidInviteWizard just above it in SelectBidDialog.
 */
export function ManualBidPanel({
  propertyId,
  projectId,
  vendors,
  scopeItems,
  editingBidId,
  onClose,
}: {
  propertyId: number;
  projectId: number;
  vendors: BidPackageOption["vendors"];
  scopeItems: BidPackageOption["scopeItems"];
  /** Editing this bid's numbers rather than recording a new one. */
  editingBidId?: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const editing = editingBidId != null;
  const [loading, setLoading] = useState(editing);
  const [busy, setBusy] = useState(false);
  const [vendorId, setVendorId] = useState("");
  const [receivedDate, setReceivedDate] = useState(() =>
    editing ? "" : new Date().toLocaleDateString("en-CA"),
  );
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<FormLine[]>(() => buildLines(scopeItems, []));

  useEffect(() => {
    if (!editing) return;
    let cancelled = false;
    (async () => {
      const detail = await getBidDetail(editingBidId);
      if (cancelled || !detail) return;
      setVendorId(detail.vendorId ? String(detail.vendorId) : "");
      setReceivedDate(detail.receivedDate ?? "");
      setNote(detail.note ?? "");
      setLines(buildLines(scopeItems, detail.lines));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // scopeItems is page data, stable for the life of this panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, editingBidId]);

  const total = lines.reduce((s, l) => s + num(l.amount), 0);

  function updateLine(key: string, patch: Partial<FormLine>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function addManualLine() {
    setLines((prev) => [
      ...prev,
      { key: `new-${prev.length}-${Date.now()}`, scopeItemId: null, description: "", amount: "", locked: false },
    ]);
  }

  function removeLine(key: string) {
    setLines((prev) => prev.filter((l) => l.key !== key));
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const payloadLines: { scopeItemId: number | null; description: string; amount: number }[] = [];
    for (const l of lines) {
      const hasAmount = l.amount.trim() !== "" && !Number.isNaN(Number(l.amount));
      if (l.locked) {
        if (hasAmount) {
          payloadLines.push({ scopeItemId: l.scopeItemId, description: l.description, amount: num(l.amount) });
        }
      } else {
        const hasDesc = l.description.trim() !== "";
        if (!hasDesc && !hasAmount) continue;
        if (!hasDesc) {
          toast.error("Each manual line needs a description");
          return;
        }
        if (!hasAmount) {
          toast.error(`Enter an amount for "${l.description.trim()}"`);
          return;
        }
        payloadLines.push({ scopeItemId: null, description: l.description.trim(), amount: num(l.amount) });
      }
    }

    if (!vendorId) {
      toast.error("Choose a vendor");
      return;
    }
    if (payloadLines.length === 0) {
      toast.error("Price at least one scope item or add a manual line");
      return;
    }

    setBusy(true);
    try {
      const base = {
        propertyId,
        projectId,
        vendorId: Number(vendorId),
        receivedDate: receivedDate || undefined,
        note: note.trim() || undefined,
        lines: payloadLines,
      };
      const res = editing ? await editBid({ id: editingBidId, ...base }) : await addBid(base);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(editing ? "Bid updated" : "Bid recorded");
      router.refresh();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>;
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <p className="text-[13px] text-muted-foreground">
        {editing
          ? "Correct what was actually quoted."
          : "For a bid that came in by phone or email instead of the portal — type in what it said, then attach the document below."}
      </p>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="mb-vendor">Vendor</Label>
          <select
            id="mb-vendor"
            required
            value={vendorId}
            onChange={(e) => setVendorId(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <option value="" disabled>
              Select a vendor…
            </option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mb-received">Received</Label>
          <Input
            id="mb-received"
            type="date"
            value={receivedDate}
            onChange={(e) => setReceivedDate(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Priced lines</Label>
          <Button type="button" size="sm" variant="ghost" onClick={addManualLine}>
            <PlusIcon className="size-4" /> Add line
          </Button>
        </div>

        {lines.length === 0 ? (
          <p className="rounded-md border border-dashed py-4 text-center text-xs text-muted-foreground">
            No scope items yet — add manual lines below.
          </p>
        ) : (
          <div className="space-y-1.5">
            {lines.map((l) => (
              <div key={l.key} className="flex items-center gap-2">
                {l.locked ? (
                  <span className="flex-1 truncate text-sm text-navy" title={l.description}>
                    {l.description}
                  </span>
                ) : (
                  <Input
                    aria-label="Line description"
                    placeholder="Labor, mobilization, …"
                    value={l.description}
                    onChange={(e) => updateLine(l.key, { description: e.target.value })}
                    className="flex-1"
                  />
                )}
                <Input
                  aria-label="Amount"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={l.amount}
                  onChange={(e) => updateLine(l.key, { amount: e.target.value })}
                  className="w-32 text-right"
                />
                {l.locked ? (
                  <span className="w-8" />
                ) : (
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Remove line"
                    onClick={() => removeLine(l.key)}
                  >
                    <TrashIcon className="size-4" />
                  </Button>
                )}
              </div>
            ))}
            <div className="flex items-center justify-between border-t pt-2 text-sm font-semibold">
              <span className="text-navy">Total</span>
              <span className="w-32 pr-10 text-right tabular-nums text-navy">{moneyExact(total)}</span>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="mb-note">Note</Label>
        <Input
          id="mb-note"
          placeholder="Optional — e.g. how this came in"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : editing ? "Save changes" : "Record bid"}
        </Button>
      </div>
    </form>
  );
}

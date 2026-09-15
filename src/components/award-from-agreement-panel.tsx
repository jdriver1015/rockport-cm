"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { moneyExact } from "@/lib/format";
import { awardFromRateAgreement } from "@/lib/actions/rate-agreements";
import type { BidPackageOption } from "@/lib/bid-package";

/**
 * Award a unit turn under a standing vendor rate agreement.
 *
 * One confirmation, not zero: the numbers below are computed from the
 * agreement's rates against this project's own confirmed scope quantities,
 * but a human still sees the breakdown and the reason before it becomes a
 * bid. Everything after this is the ordinary direct-award path — the same
 * bid row, the same Sign Contract gate — this panel only fills it in.
 */
export function AwardFromAgreementPanel({
  propertyId,
  projectId,
  agreements,
  onClose,
}: {
  propertyId: number;
  projectId: number;
  agreements: BidPackageOption["rateAgreements"];
  onClose: () => void;
}) {
  const router = useRouter();
  const [agreementId, setAgreementId] = useState(() => String(agreements[0]?.id ?? ""));
  const [busy, setBusy] = useState(false);

  const chosen = agreements.find((a) => String(a.id) === agreementId) ?? agreements[0];
  const [reason, setReason] = useState(
    () => `Standing rate agreement — ${chosen?.vendorName}, ${chosen?.preview.tierName}`,
  );

  function pick(id: string) {
    setAgreementId(id);
    const a = agreements.find((x) => String(x.id) === id);
    if (a) setReason(`Standing rate agreement — ${a.vendorName}, ${a.preview.tierName}`);
  }

  async function confirm() {
    if (!chosen) return;
    if (!reason.trim()) {
      toast.error("Say why this is awarded under the agreement");
      return;
    }
    setBusy(true);
    try {
      const res = await awardFromRateAgreement({
        propertyId,
        projectId,
        agreementId: chosen.id,
        reason: reason.trim(),
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`Awarded to ${chosen.vendorName}`);
      router.refresh();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  if (!chosen) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No standing agreement to award from.</p>;
  }
  const { preview } = chosen;

  return (
    <div className="space-y-4">
      <p className="text-[13px] text-muted-foreground">
        Priced from {chosen.vendorName}&apos;s standing rate agreement against this unit&apos;s already-confirmed
        scope — review the numbers, then confirm.
      </p>

      {agreements.length > 1 && (
        <div className="space-y-1.5">
          <Label htmlFor="agreement-pick">Agreement</Label>
          <select
            id="agreement-pick"
            value={agreementId}
            onChange={(e) => pick(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            {agreements.map((a) => (
              <option key={a.id} value={a.id}>
                {a.vendorName} — {a.preview.tierName}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="space-y-2">
        <Label>What this covers</Label>
        {preview.perLine.length === 0 ? (
          <p className="rounded-md border border-dashed py-4 text-center text-xs text-muted-foreground">
            Nothing on this project matches the agreement&apos;s cost codes.
          </p>
        ) : (
          <div className="divide-y divide-hairline rounded-card border border-border">
            {preview.perLine.map((l) => (
              <div key={l.costCodeId} className="flex items-center gap-3 px-3 py-2 text-[13px]">
                <span className="min-w-0 flex-1 truncate text-ink-700">{l.item}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {l.quantity.toLocaleString()} × {moneyExact(l.unitPrice)}
                </span>
                <span className="w-24 shrink-0 text-right tabular-nums text-navy">{moneyExact(l.total)}</span>
              </div>
            ))}
            <div className="flex items-center justify-between px-3 py-2 text-sm font-semibold">
              <span className="text-navy">Total</span>
              <span className="tabular-nums text-navy">{moneyExact(preview.total)}</span>
            </div>
          </div>
        )}
        {preview.perLine.length > 0 && preview.total <= 0 && (
          <p className="text-[11.5px] text-muted-foreground">
            This prices to $0 for this unit — nothing to award. Fix the agreement&apos;s rates, or award this unit
            separately.
          </p>
        )}
      </div>

      {preview.uncoveredScopeItems.length > 0 && (
        <p className="flex items-start gap-1.5 text-[11.5px] leading-relaxed text-gold">
          <AlertTriangleIcon className="mt-px size-3.5 shrink-0" />
          {/* One template-literal expression, not line-wrapped JSX text — see
              define-scope-dialog.tsx for why a {ternary} followed by text
              that wraps to a new line can silently lose its leading space. */}
          {`${preview.uncoveredScopeItems.length} ${
            preview.uncoveredScopeItems.length === 1 ? "line isn't" : "lines aren't"
          } on this agreement (${preview.uncoveredScopeItems.map((s) => s.item).join(", ")}) — award ${
            preview.uncoveredScopeItems.length === 1 ? "it" : "them"
          } separately.`}
        </p>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="agreement-reason">Reason on record</Label>
        <Textarea
          id="agreement-reason"
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          disabled={busy || preview.perLine.length === 0 || preview.total <= 0}
          onClick={confirm}
        >
          {busy ? "Awarding…" : `Confirm award — ${moneyExact(preview.total)}`}
        </Button>
      </div>
    </div>
  );
}

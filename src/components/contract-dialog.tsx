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
import { fmtDate } from "@/lib/format";
import { signContract } from "@/lib/actions/contract";

const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;

/**
 * Record that the contract is signed.
 *
 * The last pre-con gate, and for now the plainest: it confirms which bid is
 * being contracted and takes the date it was signed. Generating the document
 * and collecting a signature are a larger piece of work; this is the fact those
 * would end by writing, so it stays correct either way.
 */
export function ContractDialog({
  open,
  onOpenChange,
  projectId,
  contractSignedAt,
  award,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
  contractSignedAt: string | null;
  /** The awarded bid, if one has been selected. */
  award: { vendorName: string | null; total: number } | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [date, setDate] = useState(contractSignedAt ?? "");

  function save(value: string) {
    startTransition(async () => {
      const res = await signContract({ projectId, signedAt: value });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(value ? "Contract recorded" : "Contract cleared");
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Sign contract</DialogTitle>
          <DialogDescription>
            The last thing needed before work starts. Confirm the award, then record when the
            contract was signed.
          </DialogDescription>
        </DialogHeader>

        {award ? (
          <div className="rounded-card border border-border bg-muted/30 px-3.5 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.09em] text-ink-300">
              Contracting
            </p>
            <div className="mt-1.5 flex items-baseline justify-between gap-4">
              <span className="text-[15px] font-medium text-navy">
                {award.vendorName ?? "Unnamed vendor"}
              </span>
              <span className="text-[15px] font-semibold tabular-nums text-navy">
                {usd(award.total)}
              </span>
            </div>
          </div>
        ) : (
          <p className="rounded-card border border-dashed border-border px-3.5 py-3 text-[13px] text-ink-400">
            No winning bid selected yet. Select a bid first — a contract needs a vendor and a price.
          </p>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="contract-signed">Date signed</Label>
          <Input
            id="contract-signed"
            type="date"
            value={date}
            disabled={pending || !award}
            onChange={(e) => setDate(e.target.value)}
          />
          {contractSignedAt && (
            <p className="text-[12px] text-muted-foreground">
              Currently recorded as {fmtDate(contractSignedAt)}.
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-3">
          {contractSignedAt ? (
            <Button variant="ghost" disabled={pending} onClick={() => save("")}>
              Clear
            </Button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <Button variant="ghost" disabled={pending} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button disabled={pending || !award || !date} onClick={() => save(date)}>
              {pending ? "Saving…" : "Record signed contract"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2Icon, CircleIcon, ExternalLinkIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { fmtDate } from "@/lib/format";
import { advanceContract, generateContract } from "@/lib/actions/contracts";
import type { ContractStatus } from "@/lib/contracts";

const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;

export type ContractView = {
  id: number;
  status: ContractStatus;
  amount: number;
  vendorName: string | null;
  contractNumber: string;
  sentAt: string | null;
  vendorSignedAt: string | null;
  executedAt: string | null;
};

/** The steps, in the order they happen. Index into this to know where we are. */
const STEPS = [
  { key: "draft", label: "Generate the contract", done: "Generated" },
  { key: "out_for_signature", label: "Send for signature", done: "Out for signature" },
  { key: "vendor_signed", label: "Vendor signs", done: "Vendor signed" },
  { key: "executed", label: "Countersign", done: "Executed" },
] as const;

function stepIndex(status: ContractStatus | null): number {
  if (!status || status === "voided") return -1;
  return STEPS.findIndex((s) => s.key === status);
}

/**
 * Sign contract — the last pre-con gate.
 *
 * A wizard rather than a date field, because a contract is four things
 * happening in order to two parties, and the useful question is never "what
 * date" but "whose turn is it". The steps are recorded by hand today; phase C
 * replaces the middle two with an e-signature provider and the shape does not
 * change.
 */
export function ContractDialog({
  open,
  onOpenChange,
  projectId,
  contract,
  award,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
  /** The live contract, if one has been generated. */
  contract: ContractView | null;
  /** The awarded bid. Without one there is nothing to contract for. */
  award: { vendorName: string | null; total: number } | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmVoid, setConfirmVoid] = useState(false);

  const current = stepIndex(contract?.status ?? null);

  function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>, success: string) {
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(success);
      setConfirmVoid(false);
      router.refresh();
    });
  }

  const pdfUrl = `/api/projects/${projectId}/contract`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Sign contract</DialogTitle>
          <DialogDescription>
            The last thing needed before work starts. Generate the contract for the awarded bid,
            then record it through signature.
          </DialogDescription>
        </DialogHeader>

        {!award ? (
          <p className="rounded-card border border-dashed border-border px-3.5 py-3 text-[13px] text-ink-400">
            No winning bid selected yet. Select a bid first — a contract needs a vendor and a price.
          </p>
        ) : (
          <>
            <div className="rounded-card border border-border bg-muted/30 px-3.5 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.09em] text-ink-300">
                Contracting
              </p>
              <div className="mt-1.5 flex items-baseline justify-between gap-4">
                <span className="text-[15px] font-medium text-navy">
                  {contract?.vendorName ?? award.vendorName ?? "Unnamed vendor"}
                </span>
                <span className="text-[15px] font-semibold tabular-nums text-navy">
                  {usd(contract?.amount ?? award.total)}
                </span>
              </div>
              {contract && (
                <p className="mt-1 text-[11.5px] text-muted-foreground">{contract.contractNumber}</p>
              )}
            </div>

            <div className="rounded-card border border-border">
              {STEPS.map((step, i) => {
                const done = current >= i || contract?.status === "executed";
                const isNext = current === i - 1 || (!contract && i === 0);
                const stamp =
                  i === 1
                    ? contract?.sentAt
                    : i === 2
                      ? contract?.vendorSignedAt
                      : i === 3
                        ? contract?.executedAt
                        : null;

                return (
                  <div
                    key={step.key}
                    className={cn(
                      "flex items-center gap-2.5 px-3 py-2.5",
                      i > 0 && "border-t border-hairline",
                      isNext && "bg-card",
                    )}
                  >
                    {done ? (
                      <CheckCircle2Icon className="size-4 shrink-0 text-positive" />
                    ) : isNext ? (
                      <span className="flex size-4 shrink-0 items-center justify-center">
                        <span className="size-2 rounded-full bg-navy" />
                      </span>
                    ) : (
                      <CircleIcon className="size-4 shrink-0 text-ink-100" />
                    )}

                    <div className="min-w-0 flex-1">
                      <div
                        className={cn(
                          "text-[13px]",
                          isNext ? "font-medium text-navy" : done ? "text-ink-600" : "text-ink-400",
                        )}
                      >
                        {done ? step.done : step.label}
                      </div>
                      {stamp && (
                        <div className="text-[11.5px] text-muted-foreground">{fmtDate(stamp)}</div>
                      )}
                    </div>

                    {isNext && (
                      <Button
                        size="sm"
                        disabled={pending}
                        onClick={() =>
                          i === 0
                            ? run(() => generateContract({ projectId }), "Contract generated")
                            : run(
                                () =>
                                  advanceContract({
                                    projectId,
                                    contractId: contract!.id,
                                    to: STEPS[i].key as
                                      | "out_for_signature"
                                      | "vendor_signed"
                                      | "executed",
                                  }),
                                STEPS[i].done,
                              )
                        }
                      >
                        {i === 0 ? "Generate" : i === 1 ? "Mark sent" : "Mark signed"}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>

            {contract && (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <a
                  href={pdfUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-[13px] text-link hover:underline"
                >
                  Open the {contract.status === "executed" ? "contract" : "draft"} PDF
                  <ExternalLinkIcon className="size-3.5" />
                </a>

                {confirmVoid ? (
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] text-muted-foreground">
                      Void and start over?
                    </span>
                    <Button variant="ghost" size="sm" disabled={pending} onClick={() => setConfirmVoid(false)}>
                      No
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={pending}
                      onClick={() =>
                        run(
                          () =>
                            advanceContract({
                              projectId,
                              contractId: contract.id,
                              to: "voided",
                            }),
                          "Contract voided",
                        )
                      }
                    >
                      Void
                    </Button>
                  </div>
                ) : (
                  <Button variant="ghost" size="sm" disabled={pending} onClick={() => setConfirmVoid(true)}>
                    Void
                  </Button>
                )}
              </div>
            )}

            {contract?.status === "executed" && (
              <p className="text-[12px] text-muted-foreground">
                Executed {contract.executedAt ? fmtDate(contract.executedAt) : ""}. Voiding this
                re-opens the gate and un-signs the project.
              </p>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

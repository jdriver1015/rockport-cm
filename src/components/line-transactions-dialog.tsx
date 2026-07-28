"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { fmtDate, moneyExact } from "@/lib/format";

export type LineTxn = {
  id: number;
  txnDate: string | null;
  vendor: string;
  description: string | null;
  invoiceNo: string | null;
  amount: string;
};

/**
 * Actual-column cell: shows the dollar amount and, when there are transactions
 * backing it, opens a popup listing them. Values with no transactions render
 * as a plain em-dash — clicking would show nothing useful.
 */
export function LineActualButton({
  label,
  amount,
  transactions,
}: {
  label: string;
  amount: number;
  transactions: LineTxn[];
}) {
  const [open, setOpen] = useState(false);

  if (!transactions.length) {
    return <span className="block text-right font-semibold tabular-nums text-ink-100">—</span>;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="block w-full text-right font-semibold tabular-nums text-link hover:underline"
      >
        {moneyExact(amount)}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{label}</DialogTitle>
          </DialogHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Date</th>
                  <th className="py-2 pr-3 font-medium">Vendor</th>
                  <th className="py-2 pr-3 font-medium">Description</th>
                  <th className="py-2 pr-3 font-medium">Invoice #</th>
                  <th className="py-2 pl-3 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {transactions.map((t) => (
                  <tr key={t.id}>
                    <td className="py-2 pr-3 text-muted-foreground">{fmtDate(t.txnDate)}</td>
                    <td className="py-2 pr-3">{t.vendor}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{t.description ?? "—"}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{t.invoiceNo ?? "—"}</td>
                    <td className="py-2 pl-3 text-right tabular-nums">{moneyExact(t.amount)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 font-semibold">
                  <td colSpan={4} className="py-2 pr-3 text-right">
                    Total
                  </td>
                  <td className="py-2 pl-3 text-right tabular-nums">{moneyExact(amount)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

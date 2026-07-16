"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { money } from "@/lib/format";
import { confirmImportAccounts } from "@/lib/actions/gl";

export type AccountRow = {
  code: string;
  name: string | null;
  rowCount: number;
  total: number;
  suggested: boolean;
  remembered: boolean;
};

/**
 * Account-selection step for a grouped GL import. Construction/CapEx accounts
 * are pre-checked (by heuristic, or by this property's remembered choices).
 * Confirming imports only the checked accounts' rows and remembers the choice.
 */
export function GlAccountPicker({
  propertyId,
  batchId,
  accounts,
}: {
  propertyId: number;
  batchId: number;
  accounts: AccountRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(accounts.filter((a) => a.suggested).map((a) => a.code)),
  );
  const [showAll, setShowAll] = useState(false);

  // Default view hides the long tail of zero-activity operational accounts;
  // anything checked or with spend stays visible.
  const visible = useMemo(
    () =>
      accounts.filter((a) => showAll || a.suggested || checked.has(a.code) || a.rowCount > 0),
    [accounts, showAll, checked],
  );

  const toggle = (code: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  const selectedTotal = accounts
    .filter((a) => checked.has(a.code))
    .reduce((sum, a) => sum + a.total, 0);
  const selectedRows = accounts
    .filter((a) => checked.has(a.code))
    .reduce((sum, a) => sum + a.rowCount, 0);

  function confirm() {
    startTransition(async () => {
      const res = await confirmImportAccounts(batchId, [...checked]);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`Imported ${res.count} transaction${res.count === 1 ? "" : "s"}`);
      router.push(`/properties/${propertyId}/gl/${batchId}`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Pick the construction / CapEx accounts to import. {checked.size} selected ·{" "}
          {selectedRows} rows · {money(selectedTotal)}
        </p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="text-sm text-gold-link hover:underline"
          >
            {showAll ? "Hide operational accounts" : `Show all ${accounts.length} accounts`}
          </button>
          <Button disabled={pending || checked.size === 0} onClick={confirm}>
            {pending ? "Importing…" : `Import ${checked.size} account${checked.size === 1 ? "" : "s"}`}
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10" />
              <TableHead>Account</TableHead>
              <TableHead>Name</TableHead>
              <TableHead className="text-right">Rows</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((a) => (
              <TableRow
                key={a.code}
                className="cursor-pointer"
                onClick={() => toggle(a.code)}
              >
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={checked.has(a.code)}
                    onChange={() => toggle(a.code)}
                  />
                </TableCell>
                <TableCell className="font-mono text-xs text-navy">{a.code}</TableCell>
                <TableCell className="text-sm">
                  {a.name ?? "—"}
                  {a.suggested && (
                    <span className="ml-2 rounded bg-gold/15 px-1.5 py-0.5 text-[10px] font-medium text-gold-link">
                      {a.remembered ? "remembered" : "suggested"}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {a.rowCount}
                </TableCell>
                <TableCell className="text-right tabular-nums">{money(a.total)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { money, fmtDate } from "@/lib/format";
import {
  excludeTransaction,
  postAllReady,
  postBatch,
  postTransaction,
  restoreTransaction,
  updateTransaction,
} from "@/lib/actions/gl";
import type { ActionResult } from "@/lib/action-result";

type Txn = {
  id: number;
  vendorRaw: string | null;
  description: string | null;
  amount: string;
  txnDate: string | null;
  unitLabel: string | null;
  costCodeId: number | null;
  projectId: number | null;
  status: "staged" | "needs_review" | "excluded" | "posted";
  excludeReason: string | null;
};

type CostCode = { id: number; code: string; name: string };
type Project = { id: number; name: string; kind: string; costCodeId: number | null };

export function GlReviewQueue({
  propertyId,
  batchId,
  transactions,
  costCodes,
  projects,
}: {
  propertyId: number;
  /** When set, the bulk action posts only this batch's ready rows */
  batchId?: number;
  transactions: Txn[];
  costCodes: CostCode[];
  projects: Project[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const readyCount = transactions.filter((t) => t.status === "staged" && t.costCodeId).length;

  const run = (fn: () => Promise<ActionResult>, ok?: string) =>
    startTransition(async () => {
      try {
        const result = await fn();
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        if (ok) toast.success(ok);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Something went wrong");
      }
    });

  if (transactions.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Nothing in the review queue. Drop a GL export above to start.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {transactions.length} in queue · {readyCount} ready to post
        </p>
        <Button
          disabled={pending || readyCount === 0}
          onClick={() =>
            startTransition(async () => {
              const result = batchId ? await postBatch(batchId) : await postAllReady(propertyId);
              if (!result.ok) {
                toast.error(result.error);
                return;
              }
              toast.success(`Posted ${result.count} transaction${result.count === 1 ? "" : "s"}`);
              router.refresh();
            })
          }
        >
          Post all ready ({readyCount})
        </Button>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Vendor / description</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Cost code</TableHead>
              <TableHead>Project</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {transactions.map((t) => {
              const excluded = t.status === "excluded";
              return (
                <TableRow key={t.id} className={excluded ? "opacity-60" : undefined}>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {fmtDate(t.txnDate)}
                  </TableCell>
                  <TableCell className="max-w-xs">
                    <div className="font-medium text-navy">{t.vendorRaw ?? "—"}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {t.description ?? ""}
                      {t.unitLabel ? ` · ${t.unitLabel}` : ""}
                    </div>
                    {excluded && (
                      <Badge variant="outline" className="mt-1 text-[10px]">
                        {t.excludeReason ?? "Excluded"}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{money(t.amount)}</TableCell>
                  <TableCell>
                    <select
                      disabled={pending || excluded}
                      value={t.costCodeId ?? ""}
                      onChange={(e) =>
                        run(() =>
                          updateTransaction({
                            transactionId: t.id,
                            costCodeId: e.target.value ? Number(e.target.value) : null,
                            projectId: t.projectId,
                          }),
                        )
                      }
                      className="h-8 w-44 rounded-md border border-input bg-transparent px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
                    >
                      <option value="">— needs review —</option>
                      {costCodes.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.code} {c.name}
                        </option>
                      ))}
                    </select>
                  </TableCell>
                  <TableCell>
                    <select
                      disabled={pending || excluded}
                      value={t.projectId ?? ""}
                      onChange={(e) =>
                        run(() =>
                          updateTransaction({
                            transactionId: t.id,
                            costCodeId: t.costCodeId,
                            projectId: e.target.value ? Number(e.target.value) : null,
                          }),
                        )
                      }
                      className="h-8 w-44 rounded-md border border-input bg-transparent px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
                    >
                      <option value="">— unassigned —</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {excluded ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pending}
                          onClick={() => run(() => restoreTransaction(t.id), "Restored to queue")}
                        >
                          Restore
                        </Button>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            disabled={pending || !t.costCodeId}
                            onClick={() => run(() => postTransaction(t.id), "Posted")}
                          >
                            Post
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={pending}
                            onClick={() => run(() => excludeTransaction(t.id), "Excluded")}
                          >
                            Exclude
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

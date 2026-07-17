"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { EllipsisIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TableCell, TableRow } from "@/components/ui/table";
import { fmtDate } from "@/lib/format";
import { deleteBatch, restoreBatch } from "@/lib/actions/rent-rolls";

type Batch = {
  id: number;
  fileName: string;
  sourceSystem: string | null;
  asOfDate: string | null;
  createdAt: string | Date;
  rowCount: number;
  occupancyPct: string | null;
  status: string;
};

function statusBadge(status: string): { label: string; variant: "positive" | "pending" | "secondary" } {
  switch (status) {
    case "committed":
      return { label: "committed", variant: "positive" };
    case "failed":
      return { label: "failed", variant: "secondary" };
    case "parsing":
      return { label: "parsing…", variant: "pending" };
    default:
      return { label: "review", variant: "pending" };
  }
}

export function RentRollBatchRow({ propertyId, batch }: { propertyId: number; batch: Batch }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const href = `/properties/${propertyId}/rent-rolls/${batch.id}`;
  const badge = statusBadge(batch.status);

  function handleDelete() {
    if (!window.confirm(`Delete the rent roll "${batch.fileName}"?`)) return;
    startTransition(async () => {
      const res = await deleteBatch(batch.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Rent roll deleted", {
        action: {
          label: "Undo",
          onClick: () => {
            startTransition(async () => {
              const undo = await restoreBatch(batch.id);
              if (!undo.ok) toast.error(undo.error);
              else router.refresh();
            });
          },
        },
      });
      router.refresh();
    });
  }

  return (
    <TableRow
      className={pending ? "cursor-pointer opacity-60" : "cursor-pointer"}
      onClick={() => router.push(href)}
    >
      <TableCell className="font-medium text-navy">{batch.fileName}</TableCell>
      <TableCell className="text-muted-foreground">{batch.sourceSystem ?? "—"}</TableCell>
      <TableCell className="text-muted-foreground">{fmtDate(batch.asOfDate)}</TableCell>
      <TableCell className="text-muted-foreground">{fmtDate(batch.createdAt)}</TableCell>
      <TableCell className="text-right tabular-nums">{batch.rowCount || "—"}</TableCell>
      <TableCell className="text-right tabular-nums">
        {batch.occupancyPct != null ? `${Number(batch.occupancyPct).toFixed(1)}%` : "—"}
      </TableCell>
      <TableCell>
        <Badge variant={badge.variant}>{badge.label}</Badge>
      </TableCell>
      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
        <DropdownMenu>
          <DropdownMenuTrigger disabled={pending} render={<Button variant="ghost" size="icon-sm" />}>
            <EllipsisIcon />
            <span className="sr-only">Actions</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem variant="destructive" disabled={pending} onClick={handleDelete}>
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
}

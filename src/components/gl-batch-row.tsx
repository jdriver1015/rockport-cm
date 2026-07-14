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
import { deleteBatch } from "@/lib/actions/gl";

export function GlBatchRow({
  propertyId,
  batch,
  queueCount,
  postedCount,
}: {
  propertyId: number;
  batch: { id: number; fileName: string; sourceSystem: string | null; createdAt: string | Date; rowCount: number; status: string };
  queueCount: number;
  postedCount: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const href = `/properties/${propertyId}/gl/${batch.id}`;

  function handleDelete() {
    if (
      !window.confirm(
        `Delete the import "${batch.fileName}"? This removes all of its staged and excluded rows.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const res = await deleteBatch(batch.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Import deleted");
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
      <TableCell className="text-muted-foreground">{fmtDate(batch.createdAt)}</TableCell>
      <TableCell className="text-right tabular-nums">{batch.rowCount}</TableCell>
      <TableCell className="text-right tabular-nums">
        {queueCount > 0 ? <span className="font-medium text-[#a3641f]">{queueCount}</span> : "—"}
      </TableCell>
      <TableCell className="text-right tabular-nums">{postedCount}</TableCell>
      <TableCell>
        <Badge variant={batch.status === "posted" ? "positive" : "pending"}>
          {batch.status === "posted" ? "posted" : queueCount > 0 ? `${queueCount} to review` : "ready"}
        </Badge>
      </TableCell>
      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={pending}
            render={<Button variant="ghost" size="icon-sm" />}
          >
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

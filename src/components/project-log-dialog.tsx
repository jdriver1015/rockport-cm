"use client";

import { Button } from "@/components/ui/button";
import { useDialogOpen, type ControllableDialog } from "@/lib/use-dialog-open";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ActivityLogRow } from "@/lib/actions/activity-log";

/** Date + time, local to the viewer — an audit trail needs more than the day. */
function fmtDateTime(value: string | Date | null): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Phase history lives behind a header button rather than on the page. */
export function ActivityLogDialogButton({
  entries,
  ...dialog
}: { entries: ActivityLogRow[] } & ControllableDialog) {
  const { open, setOpen, hasTrigger } = useDialogOpen(dialog);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {hasTrigger && (
        <DialogTrigger render={<Button size="sm" variant="outline" />}>Activity log</DialogTrigger>
      )}
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Activity log</DialogTitle>
          <DialogDescription>Every field change recorded against this project.</DialogDescription>
        </DialogHeader>
        {entries.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">No activity yet.</p>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Who</TableHead>
                  <TableHead>Field</TableHead>
                  <TableHead>Change</TableHead>
                  <TableHead>Note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="text-muted-foreground">{fmtDateTime(e.createdAt)}</TableCell>
                    <TableCell>{e.userName ?? "—"}</TableCell>
                    <TableCell>{e.fieldLabel}</TableCell>
                    <TableCell className="whitespace-normal">
                      {e.fromValue ? `${e.fromValue} → ${e.toValue ?? "—"}` : (e.toValue ?? "—")}
                    </TableCell>
                    <TableCell className="whitespace-normal text-muted-foreground">{e.note ?? ""}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

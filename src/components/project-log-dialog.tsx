"use client";

import { Badge } from "@/components/ui/badge";
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
import { fmtDate } from "@/lib/format";

export type LogEntry = {
  id: number;
  createdAt: string | Date | null;
  fromPhase: string | null;
  toPhase: string | null;
  toPhaseLabel: string | null;
  fromPhaseLabel: string | null;
  note: string | null;
};

/** Phase history lives behind a header button rather than on the page. */
export function ActivityLogDialogButton({
  entries,
  ...dialog
}: { entries: LogEntry[] } & ControllableDialog) {
  const { open, setOpen, hasTrigger } = useDialogOpen(dialog);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {hasTrigger && (
        <DialogTrigger render={<Button size="sm" variant="outline" />}>Activity log</DialogTrigger>
      )}
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Activity log</DialogTitle>
          <DialogDescription>Every phase change recorded against this project.</DialogDescription>
        </DialogHeader>
        {entries.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">No activity yet.</p>
        ) : (
          <ul className="max-h-[60vh] space-y-2 overflow-y-auto">
            {entries.map((e) => (
              <li key={e.id} className="flex items-center gap-3 text-sm">
                <span className="w-32 shrink-0 text-muted-foreground">{fmtDate(e.createdAt)}</span>
                <Badge variant="secondary" className="border border-border">
                  {e.fromPhaseLabel ? `${e.fromPhaseLabel} → ` : ""}
                  {e.toPhaseLabel ?? (e.fromPhaseLabel ? "" : "Created")}
                </Badge>
                {e.note && <span className="text-muted-foreground">{e.note}</span>}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

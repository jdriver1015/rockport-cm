"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Lock, LockOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { lockBudget, unlockBudget } from "@/lib/actions/budget-lock";
import type { BudgetLockEventRow } from "@/lib/property-budget-lock";

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

export function BudgetLockControl({
  propertyId,
  locked,
  lockedByName,
  lockedAt,
  events,
}: {
  propertyId: number;
  locked: boolean;
  lockedByName: string | null;
  lockedAt: string | null;
  events: BudgetLockEventRow[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  async function handleToggle() {
    setBusy(true);
    try {
      const result = locked ? await unlockBudget(propertyId, note) : await lockBudget(propertyId, note);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(locked ? "Budget unlocked" : "Budget locked");
      setNote("");
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) setNote(""); }}>
      <DialogTrigger
        render={
          <Button
            size="sm"
            variant="outline"
            className={locked ? "border-alert/30 bg-alert-bg text-alert hover:bg-alert-bg hover:text-alert" : undefined}
          >
            {locked ? <Lock className="size-3.5" /> : <LockOpen className="size-3.5" />}
            {locked ? "Locked" : "Lock budget"}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{locked ? "Budget is locked" : "Lock this budget"}</DialogTitle>
          <DialogDescription>
            {locked
              ? `Locked by ${lockedByName ?? "someone"} on ${fmtDateTime(lockedAt)}. No one can add, edit, archive, or upload a replacement budget until it's unlocked.`
              : "Blocks adding, editing, archiving, or uploading a replacement for this property's non-interior budget until it's unlocked. Interior per-unit pricing is not affected."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="lock-note">Note (optional)</Label>
          <Input
            id="lock-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={locked ? "Why unlock?" : 'Why lock, e.g. "UW final"'}
          />
        </div>

        <div className="flex justify-end">
          <Button variant={locked ? "outline" : "default"} disabled={busy} onClick={handleToggle}>
            {busy ? "Working…" : locked ? "Unlock budget" : "Lock budget"}
          </Button>
        </div>

        <div className="border-t border-border pt-3">
          <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">History</h4>
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">No lock activity yet.</p>
          ) : (
            <div className="max-h-[30vh] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Who</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Note</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {events.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="text-muted-foreground">{fmtDateTime(e.createdAt)}</TableCell>
                      <TableCell>{e.userName ?? "—"}</TableCell>
                      <TableCell className={cn("capitalize", e.action === "locked" ? "text-alert" : "text-navy")}>
                        {e.action}
                      </TableCell>
                      <TableCell className="whitespace-normal text-muted-foreground">{e.note ?? ""}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

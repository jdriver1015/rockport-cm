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
import { schedulePreWalk, startPreWalk } from "@/lib/actions/pre-walk";

/**
 * Book the pre-walk, and start it.
 *
 * Both live in one dialog because they are the same errand a day apart: you open
 * it to put the walk on the calendar, and you open it again standing in the unit
 * to begin recording what you find. Starting does not require a booked date — a
 * walk that happens unannounced is still the walk.
 */
export function PreWalkDialog({
  open,
  onOpenChange,
  projectId,
  propertySlug,
  preWalkDate,
  preWalkTime,
  auditId,
  auditStatus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
  propertySlug: string;
  preWalkDate: string | null;
  preWalkTime: string | null;
  /** The existing pre-walk audit, if one has been started. */
  auditId: number | null;
  auditStatus: "draft" | "complete" | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [date, setDate] = useState(preWalkDate ?? "");
  // Stored as HH:MM:SS by Postgres; the input wants HH:MM.
  const [time, setTime] = useState((preWalkTime ?? "").slice(0, 5));

  function save() {
    startTransition(async () => {
      const res = await schedulePreWalk({ projectId, date, time });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(date ? "Pre-walk scheduled" : "Pre-walk cleared");
      onOpenChange(false);
      router.refresh();
    });
  }

  function go() {
    startTransition(async () => {
      const res = await startPreWalk({ projectId });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      onOpenChange(false);
      router.push(`/properties/${propertySlug}/audits/${res.auditId}`);
      router.refresh();
    });
  }

  const started = auditStatus != null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Pre-walk</DialogTitle>
          <DialogDescription>
            The walk that produces the scope. Its findings become the scope lines you bid.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-[1fr_9rem] gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pw-date">Date</Label>
              <Input
                id="pw-date"
                type="date"
                value={date}
                disabled={pending}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pw-time">Time</Label>
              <Input
                id="pw-time"
                type="time"
                value={time}
                disabled={pending || !date}
                onChange={(e) => setTime(e.target.value)}
              />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Clearing the date un-schedules the walk. A date without a time is still a booking.
          </p>

          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" disabled={pending} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              variant="outline"
              disabled={pending || (date === (preWalkDate ?? "") && time === (preWalkTime ?? "").slice(0, 5))}
              onClick={save}
            >
              {pending ? "Saving…" : "Save schedule"}
            </Button>
          </div>

          <div className="space-y-2 border-t border-border pt-4">
            {auditStatus === "complete" ? (
              <>
                <p className="text-[13px] text-ink-700">
                  This walk is complete. Its findings are on the walk itself.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  nativeButton={false}
                  render={<a href={`/properties/${propertySlug}/audits/${auditId}`} />}
                >
                  Open pre-walk
                </Button>
              </>
            ) : (
              <>
                <p className="text-[13px] text-ink-700">
                  {started
                    ? "A walk is in progress. Pick it up where you left off."
                    : preWalkDate
                      ? `Booked for ${fmtDate(preWalkDate)}${time ? ` at ${time}` : ""}. Start it when you are in the unit.`
                      : "You can start a walk without booking one first."}
                </p>
                <Button disabled={pending} onClick={go}>
                  {started ? "Continue pre-walk" : "Start Pre-Walk"}
                </Button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

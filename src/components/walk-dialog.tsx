"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { QUARTER_HOUR_STEP } from "@/lib/walk-time";
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
import { scheduleWalk, startWalk } from "@/lib/actions/walks";
import { WALK_KIND, type WalkKind } from "@/lib/walk-kinds";

/**
 * Book a walk, and start it.
 *
 * Both live in one dialog because they are the same errand a day apart: you open
 * it to put the walk on the calendar, and you open it again standing in the unit
 * to begin recording what you find. Starting does not require a booked date — a
 * walk that happens unannounced is still the walk.
 */
export function WalkDialog({
  open,
  onOpenChange,
  projectId,
  kind,
  propertySlug,
  walkDate,
  walkTime,
  auditId,
  auditStatus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
  /** Which walk this dialog is for. Everything visible reads from WALK_KIND. */
  kind: WalkKind;
  propertySlug: string;
  walkDate: string | null;
  walkTime: string | null;
  /** The existing audit for this kind, if one has been started. */
  auditId: number | null;
  auditStatus: "draft" | "complete" | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [date, setDate] = useState(walkDate ?? "");
  // Stored as HH:MM:SS by Postgres; the input wants HH:MM.
  const [time, setTime] = useState((walkTime ?? "").slice(0, 5));

  function save() {
    startTransition(async () => {
      const res = await scheduleWalk({ projectId, kind, date, time });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`${WALK_KIND[kind].titleWord} ${date ? "scheduled" : "cleared"}`);
      onOpenChange(false);
      router.refresh();
    });
  }

  function go() {
    startTransition(async () => {
      const res = await startWalk({ projectId, kind });
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
          <DialogTitle>{WALK_KIND[kind].label}</DialogTitle>
          <DialogDescription>
            {WALK_KIND[kind].purpose} Its findings become {WALK_KIND[kind].findingsBecome}.
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
                step={QUARTER_HOUR_STEP}
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
              disabled={pending || (date === (walkDate ?? "") && time === (walkTime ?? "").slice(0, 5))}
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
                  Open {WALK_KIND[kind].titleWord.toLowerCase()}
                </Button>
              </>
            ) : (
              <>
                <p className="text-[13px] text-ink-700">
                  {started
                    ? "A walk is in progress. Pick it up where you left off."
                    : walkDate
                      ? `Booked for ${fmtDate(walkDate)}${time ? ` at ${time}` : ""}. Start it when you are in the unit.`
                      : "You can start a walk without booking one first."}
                </p>
                <Button disabled={pending} onClick={go}>
                  {started ? "Continue walk" : `Start ${WALK_KIND[kind].label}`}
                </Button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

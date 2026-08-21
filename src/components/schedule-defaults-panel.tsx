"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fmtDate } from "@/lib/format";
import { updateScheduleDefaults } from "@/lib/actions/interior-defaults";
import {
  dateFromIso,
  PRE_WALK_KEY,
  SCHEDULE_KEYS,
  SCHEDULE_LABELS,
  describeSchedule,
  scheduleWarnings,
  suggestSchedule,
  type ScheduleKey,
  type ScheduleSettings,
} from "@/lib/schedule-defaults";

/**
 * The suggested schedule a new unit turn's dates default to.
 *
 * Shows the dates a project created today would get, not just the day counts:
 * "10 days" is hard to sanity-check, "Mon 31 Aug" is not — and it makes the
 * weekend roll-forward visible rather than surprising.
 */
export function ScheduleDefaultsPanel({
  schedule,
  todayIso,
}: {
  schedule: ScheduleSettings;
  /** Today in the business timezone, decided by the server so the preview
   *  cannot differ between the rendered HTML and the hydrated page. */
  todayIso: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [enabled, setEnabled] = useState(schedule.enabled);
  const [offsets, setOffsets] = useState<Record<ScheduleKey, number>>(schedule.offsets);

  // The anchor comes from the server, so the preview is the same date the
  // wizard would actually use rather than whatever the viewer's clock says.
  const preview = suggestSchedule({ enabled: true, offsets }, dateFromIso(todayIso));
  const warnings = scheduleWarnings(preview);

  const dirty =
    enabled !== schedule.enabled ||
    SCHEDULE_KEYS.some((k) => offsets[k] !== schedule.offsets[k]);

  async function save() {
    setBusy(true);
    try {
      const res = await updateScheduleDefaults({ enabled, offsets });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Schedule defaults saved — applies to projects created from here on");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-baseline justify-between gap-3">
        <CardTitle className="text-base text-navy">Schedule for a new unit turn</CardTitle>
        <span className="text-sm text-muted-foreground">
          Prefills the dates in the interior project wizard.
        </span>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="size-3.5 accent-navy"
          />
          <span className="text-[13px] font-medium text-navy">Suggest dates</span>
          <span className="text-[11px] text-muted-foreground">
            Off leaves the wizard&apos;s dates blank.
          </span>
        </label>

        <div className="divide-y divide-hairline rounded-card border border-border">
          <div className="grid grid-cols-[1fr_7rem_9rem] gap-3 bg-muted/30 px-3 py-1.5">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-ink-300">
              Phase
            </span>
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-ink-300">
              Days out
            </span>
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-ink-300">
              If created today
            </span>
          </div>
          {SCHEDULE_KEYS.map((key) => (
            <div key={key} className="grid grid-cols-[1fr_7rem_9rem] items-center gap-3 px-3 py-2">
              <Label htmlFor={`sched-${key}`} className="text-[13px] font-normal">
                {SCHEDULE_LABELS[key]}
                {key === PRE_WALK_KEY && (
                  <span className="ml-2 text-[10.5px] uppercase tracking-[0.09em] text-ink-300">
                    not a phase
                  </span>
                )}
              </Label>
              <Input
                id={`sched-${key}`}
                type="number"
                step="1"
                min="-365"
                max="365"
                className="h-8 text-xs"
                value={offsets[key]}
                disabled={!enabled}
                onChange={(e) =>
                  setOffsets((prev) => ({ ...prev, [key]: Math.trunc(Number(e.target.value) || 0) }))
                }
              />
              <span className="text-[12.5px] tabular-nums text-ink-500">
                {fmtDate(preview[key])}
              </span>
            </div>
          ))}
        </div>

        <p className="text-[11px] text-muted-foreground">
          Days are counted from the day the project is created, each independently — not chained off
          the one before — so changing one date does not move the others. A date landing on a
          weekend rolls forward to the Monday. Currently{" "}
          <span className="font-medium text-navy">{describeSchedule(offsets)}</span>.
        </p>

        {warnings.length > 0 && (
          <p className="rounded-control bg-alert-bg px-2.5 py-1.5 text-[12px] text-alert">
            {warnings.join(" · ")}.
          </p>
        )}

        <div className="flex justify-end">
          <Button disabled={busy || !dirty} onClick={save}>
            {busy ? "Saving…" : "Save schedule"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

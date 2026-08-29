"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { fmtDateShort } from "@/lib/format";
import type { ProjectPhaseKey } from "@/lib/stages";
import {
  PRE_WALK_KEY,
  SCHEDULE_KEYS,
  SCHEDULE_LABELS,
  daysBetween,
  describeDays,
  describeSchedule,
  phaseRun,
  scheduleWarnings,
  type ScheduleKey,
  type ScheduleSettings,
} from "@/lib/schedule-defaults";

// ---------------------------------------------------------------------------
// Target phasing, shared by every wizard that creates a project.
//
// This was the interior wizard's fourth step. A common-area project needs the
// same step and exactly the same meaning — each date is the day a phase BEGINS,
// and a phase runs until the day before the next one starts — so it lives in
// one component rather than being copied. Two copies of scheduling logic is how
// the rest of this app kept ending up with two answers to one question.
//
// The only thing that varies is the pre-walk: a unit turn is scoped by walking
// the unit, and a common-area project is not.
// ---------------------------------------------------------------------------

export function TargetPhasingStep({
  dates,
  setDate,
  onReset,
  suggested,
  schedule,
  showPreWalk = true,
  /** What the dates describe, for the sentence at the top. */
  noun = "the whole job",
}: {
  dates: Record<ScheduleKey, string>;
  setDate: (key: ScheduleKey, value: string) => void;
  onReset: () => void;
  suggested: Record<ScheduleKey, string>;
  schedule: ScheduleSettings;
  showPreWalk?: boolean;
  noun?: string;
}) {
  const keys = showPreWalk ? SCHEDULE_KEYS : SCHEDULE_KEYS.filter((k) => k !== PRE_WALK_KEY);
  const warnings = scheduleWarnings(dates);
  const touched = keys.some((k) => dates[k] !== suggested[k]);

  const spanFrom = showPreWalk ? dates[PRE_WALK_KEY] : dates.precon;
  const span = spanFrom && dates.complete ? daysBetween(spanFrom, dates.complete) : null;

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-[13px] leading-relaxed text-ink-600">
          Set the day each phase is meant to{" "}
          <span className="font-medium text-navy">begin</span>. Each phase runs until the day before
          the next one starts, so these {keys.length} dates lay out {noun}.
        </p>
        <p className="text-[11.5px] leading-relaxed text-muted-foreground">
          A target, not a commitment — the project records its real dates as it moves through each
          phase, and a missed target pushes itself and everything after it forward. Leave one blank
          to fill in later. Vendors are set by awarding a bid, not here.
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <Label>Target phasing</Label>
          {schedule.enabled && (
            <span className="text-[11px] text-muted-foreground">
              Portfolio default — {describeSchedule(schedule.offsets)}
              {touched && (
                <>
                  {" · "}
                  <button
                    type="button"
                    className="underline hover:text-foreground"
                    onClick={onReset}
                  >
                    reset
                  </button>
                </>
              )}
            </span>
          )}
        </div>

        <div className="divide-y divide-hairline rounded-card border border-border">
          {keys.map((key) => {
            const isPreWalk = key === PRE_WALK_KEY;
            // Derived, never typed: the end of a phase is the day before the
            // next one begins, so showing it here is the only place the implied
            // span is visible before the project exists.
            const run = isPreWalk ? null : phaseRun(dates, key as ProjectPhaseKey);
            return (
              <div key={key}>
                <div
                  className={cn(
                    "flex items-center gap-3 px-3 py-2",
                    isPreWalk && "bg-surface-muted/40",
                  )}
                >
                  <Label htmlFor={`tp-${key}`} className="flex-1 text-[13px] font-normal">
                    {SCHEDULE_LABELS[key]}
                    {isPreWalk ? (
                      <span className="ml-2 text-[10.5px] tracking-[0.09em] text-ink-300 uppercase">
                        before the project
                      </span>
                    ) : key === "complete" ? (
                      <span className="ml-1.5 text-[12px] text-muted-foreground">
                        — target finish
                      </span>
                    ) : (
                      <span className="ml-1.5 text-[12px] text-muted-foreground">begins</span>
                    )}
                  </Label>
                  <Input
                    id={`tp-${key}`}
                    type="date"
                    className="w-44"
                    value={dates[key]}
                    onChange={(e) => setDate(key, e.target.value)}
                  />
                </div>
                {run && (
                  <p className="ml-3 border-l-2 border-hairline py-0.5 pl-3 text-[11px] text-muted-foreground">
                    {run.days > 0
                      ? `runs ${describeDays(run.days)}, through ${fmtDateShort(run.endsIso)}`
                      : `${describeDays(run.days)} — the next phase begins ${
                          run.days === 0 ? "the same day" : "earlier"
                        }`}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {span !== null && (
          <div className="flex items-center justify-between px-0.5 text-[12px] text-muted-foreground">
            <span>{showPreWalk ? "Pre-walk to sign-off" : "Start to sign-off"}</span>
            <span className="font-medium text-navy tabular-nums">{describeDays(span)}</span>
          </div>
        )}

        {warnings.length > 0 && (
          <p className="rounded-control bg-alert-bg px-2.5 py-1.5 text-[12px] text-alert">
            {warnings.join(" · ")}. Saving is still allowed — dates get resequenced often — but
            check this is what you meant.
          </p>
        )}
      </div>
    </div>
  );
}

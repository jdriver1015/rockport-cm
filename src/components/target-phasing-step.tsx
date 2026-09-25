"use client";

import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { fmtDateShort } from "@/lib/format";
import type { ProjectPhaseKey } from "@/lib/stages";
import {
  PRE_WALK_KEY,
  SCHEDULE_KEYS,
  SCHEDULE_LABELS,
  addDays,
  dateFromIso,
  daysBetween,
  describeDays,
  describeSchedule,
  phaseRun,
  scheduleWarnings,
  toIsoDate,
  type ScheduleKey,
  type ScheduleSettings,
} from "@/lib/schedule-defaults";

/**
 * The nearest earlier key in `keys` that already has a date — what a duration
 * input measures forward from. Null means this key has nothing to chain off
 * (the first key always qualifies, and so does any key whose entire prefix is
 * still blank), so it falls back to being a free date itself rather than a
 * duration with no anchor to add to.
 */
function findAnchorKey(
  keys: ScheduleKey[],
  dates: Record<ScheduleKey, string>,
  index: number,
): ScheduleKey | null {
  for (let i = index - 1; i >= 0; i--) {
    if (dates[keys[i]]) return keys[i];
  }
  return null;
}

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

/** Phase name, its day count, and the date it lands on — one grid so every
 *  row's numbers line up regardless of how long a phase's name is.
 *  `minmax(0,1fr)` rather than a bare `1fr`: without it, a grid track never
 *  shrinks below its content's natural width, and "Punch and Sign Off" pushed
 *  the whole row wider than the card on a phone. */
const ROW_GRID = "grid grid-cols-[minmax(0,1fr)_56px_152px] items-center gap-3";

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
  // Scoped to `keys`: a common-area project never shows a pre-walk date, so
  // checking it here would report a warning this step has no field to fix.
  const warnings = scheduleWarnings(dates, keys);
  const touched = keys.some((k) => dates[k] !== suggested[k]);

  const spanFrom = showPreWalk ? dates[PRE_WALK_KEY] : dates.precon;
  const span = spanFrom && dates.complete ? daysBetween(spanFrom, dates.complete) : null;

  /**
   * Move the row at `index` to `newDate`, then carry every later row that
   * already has a date forward (or back) by the same number of days.
   *
   * This is what makes "duration, not date" hold together: every later row's
   * own length is a gap between two dates, and sliding an earlier row without
   * sliding the rest would silently shrink or stretch every gap after it. A
   * blank row is left alone — it has no length to preserve — and a genuinely
   * new date (nothing was there before) has nothing to carry either, since
   * "carry the rest" only means something relative to a date that moved.
   */
  function applyDate(index: number, newDate: string) {
    const key = keys[index];
    const oldDate = dates[key];
    setDate(key, newDate);
    if (!oldDate || !newDate) return;
    const delta = daysBetween(oldDate, newDate);
    if (delta === 0) return;
    for (let j = index + 1; j < keys.length; j++) {
      const later = dates[keys[j]];
      if (later) setDate(keys[j], toIsoDate(addDays(dateFromIso(later), delta)));
    }
  }

  /**
   * Move `key` to `days` after `anchorKey`'s own date — the only way a chained
   * row's date changes. Clamped to zero or more so a phase can never be pushed
   * earlier than the one it follows; blank clears the date rather than parking
   * it at the anchor, so "leave one blank to fill in later" still works.
   */
  function setDuration(index: number, anchorKey: ScheduleKey, raw: string) {
    if (raw === "") {
      applyDate(index, "");
      return;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    const anchor = dates[anchorKey];
    if (!anchor) return;
    const days = Math.trunc(n);
    if (days < 0) {
      toast.error("Days can't be negative — a phase can't start before the one it follows");
    }
    applyDate(index, toIsoDate(addDays(dateFromIso(anchor), Math.max(0, days))));
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-[13px] leading-relaxed text-ink-600">
          Only the first date is set directly — every phase after it is a number of days from the one
          before, so these {keys.length} entries lay out {noun} by duration, not by date.
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

        <div className="rounded-card border border-border">
          <div
            className={cn(
              ROW_GRID,
              "border-b border-hairline px-3 py-1.5 text-[10.5px] font-semibold tracking-[0.08em] text-ink-300 uppercase",
            )}
          >
            <span>Phase</span>
            <span className="text-right">Days</span>
            <span className="text-right">Date</span>
          </div>
          <div className="divide-y divide-hairline">
            {keys.map((key, i) => {
              const isPreWalk = key === PRE_WALK_KEY;
              // Derived, never typed: the end of a phase is the day before the
              // next one begins, so showing it here is the only place the implied
              // span is visible before the project exists.
              const run = isPreWalk ? null : phaseRun(dates, key as ProjectPhaseKey);
              // Null means nothing earlier has a date yet, so this row has
              // nothing to count forward from and stays a free date itself —
              // otherwise it is however many days past whichever earlier phase
              // is actually dated.
              const anchorKey = findAnchorKey(keys, dates, i);
              const isAnchor = anchorKey === null;
              const duration =
                anchorKey && dates[key] ? daysBetween(dates[anchorKey], dates[key]) : null;
              // Filling a previously-blank phase carries nothing forward (see
              // applyDate's doc comment), so a later phase can be left dated
              // before the one it now follows. The duration input can't be
              // clamped to fix it — the row's OWN date didn't move, the
              // anchor did — so this is a visible flag rather than a block.
              const isNegative = duration !== null && duration < 0;
              return (
                <div key={key}>
                  <div className={cn(ROW_GRID, "px-3 py-2", isPreWalk && "bg-surface-muted/40")}>
                    <Label htmlFor={`tp-${key}`} className="text-[13px] font-normal">
                      {SCHEDULE_LABELS[key]}
                      {isPreWalk && (
                        <span className="ml-2 text-[10px] tracking-[0.08em] text-ink-300 uppercase">
                          before project
                        </span>
                      )}
                    </Label>
                    {isAnchor ? (
                      <span />
                    ) : (
                      <Input
                        id={`tp-${key}`}
                        type="number"
                        min={0}
                        step={1}
                        inputMode="numeric"
                        placeholder="—"
                        aria-label={`Days after ${SCHEDULE_LABELS[anchorKey]}`}
                        className={cn(
                          "h-8 w-full px-1.5 text-right",
                          isNegative && "border-alert text-alert focus-visible:ring-alert/50",
                        )}
                        value={duration ?? ""}
                        onChange={(e) => setDuration(i, anchorKey, e.target.value)}
                      />
                    )}
                    {isAnchor ? (
                      <Input
                        id={`tp-${key}`}
                        type="date"
                        className="h-8 w-full"
                        value={dates[key]}
                        onChange={(e) => applyDate(i, e.target.value)}
                      />
                    ) : (
                      <span className="text-right text-[12.5px] tabular-nums text-ink-500">
                        {dates[key] ? fmtDateShort(dates[key]) : "—"}
                      </span>
                    )}
                  </div>
                  {run && (
                    <p className="px-3 pb-1.5 text-[11px] text-muted-foreground">
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
        </div>

        {span !== null && (
          <div className="flex items-center justify-between px-0.5 text-[12px] text-muted-foreground">
            <span>{showPreWalk ? "Pre-walk to sign-off" : "Start to sign-off"}</span>
            <span className="font-medium text-navy tabular-nums">{describeDays(span)}</span>
          </div>
        )}

        {warnings.length > 0 && (
          <p className="rounded-control bg-alert-bg px-2.5 py-1.5 text-[12px] text-alert">
            {warnings.join(" · ")}. Fix the order before continuing — a phase can&rsquo;t target a
            start before the one it follows.
          </p>
        )}
      </div>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  addMonths,
  differenceInCalendarDays,
  eachDayOfInterval,
  endOfMonth,
  format,
  startOfMonth,
} from "date-fns";
import { phaseLabel, PROJECT_PHASES, type ProjectPhaseKey } from "@/lib/stages";
import { PHASE_KEYS, phaseRun } from "@/lib/schedule-defaults";
import { cn } from "@/lib/utils";
import { projectSlug } from "@/lib/slug";
import type { ScheduleProject } from "@/lib/schedule-data";

const DAY_WIDTH = 32;
const NAME_COL_WIDTH = 220;
const PAST_PAD_MONTHS = 2;
const FUTURE_PAD_MONTHS = 6;

function parseDate(s: string | null): Date | null {
  if (!s) return null;
  const d = new Date(`${s}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

type Dated = { p: ScheduleProject; start: Date; end: Date; bands: Band[] };

type Band = { key: ProjectPhaseKey; from: Date; to: Date };

/**
 * One band per dated phase, derived from where the NEXT dated phase begins.
 *
 * phaseRun is the same helper the wizard and the project's phase table use, so
 * all three agree on the day a phase ends rather than each doing the arithmetic
 * its own way. It returns null for the last dated phase — nothing follows it —
 * and that band runs to the project's end instead.
 *
 * Sparse input stays sparse. A project with one dated phase gets one band, not
 * a fabricated four.
 */
function bandsFor(p: ScheduleProject, end: Date): Band[] {
  const out: Band[] = [];
  for (const key of PHASE_KEYS) {
    const begin = p.phaseTargets[key];
    if (!begin) continue;
    const from = parseDate(begin);
    if (!from) continue;
    const run = phaseRun(p.phaseTargets, key);
    const to = run ? (parseDate(run.endsIso) ?? from) : end;
    out.push({ key, from, to: to < from ? from : to });
  }
  return out;
}

/**
 * The px each phase label needs, including the band's 8px padding either side.
 *
 * Measured in the browser at the band's own type — 11px/500 in the app sans —
 * rather than estimated. A characters-times-a-constant guess ran 25% high on
 * "Pre-Construction" (119 against a real 107) and short on "Complete", because
 * character widths are not uniform; the high side silently dropped labels from
 * bands with room to spare. Four fixed labels do not justify measuring text at
 * runtime, and PROJECT_PHASES is what makes four fixed labels a safe assumption.
 */
const LABEL_WIDTH: Record<ProjectPhaseKey, number> = {
  precon: 109, // "Pre-Construction" 91 + 16, +2 slack
  in_process: 73, // "In Process" 55 + 16
  punch: 120, // "Punch and Sign Off" 101 + 16
  complete: 69, // "Complete" 51 + 16
};

function fitsLabel(key: ProjectPhaseKey): number {
  return LABEL_WIDTH[key];
}

/**
 * The ramp, darkening as the job advances. One hue — see --phase-* in
 * globals.css. Text flips to white where the band is dark enough to need it.
 */
const BAND_STYLE: Record<ProjectPhaseKey, { bg: string; text: string }> = {
  precon: { bg: "bg-phase-precon", text: "text-navy" },
  in_process: { bg: "bg-phase-in-process", text: "text-navy" },
  punch: { bg: "bg-phase-punch", text: "text-white" },
  complete: { bg: "bg-phase-complete", text: "text-white" },
};

/** Says which end of the bar is a record and which is still a plan. */
function barTitle(p: ScheduleProject): string {
  const from = p.actualStart
    ? `started ${p.actualStart}`
    : p.targetStart
      ? `target start ${p.targetStart}`
      : `pre-walk ${p.preWalkDate}`;
  const to = p.actualCompletion
    ? `completed ${p.actualCompletion}`
    : p.targetCompletion
      ? `target finish ${p.targetCompletion}`
      : "in progress";
  return `${from} → ${to}`;
}

export function GanttView({ projects }: { projects: ScheduleProject[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const dated = useMemo(
    () =>
      projects
        .map((p) => {
          // What really happened wins; the target is the fallback while it has
          // not happened yet. One bar per project still, but its ends no longer
          // change meaning underneath the reader — see ScheduleProject.
          const start =
            parseDate(p.actualStart) ?? parseDate(p.targetStart) ?? parseDate(p.preWalkDate);
          if (!start) return null;
          const end = parseDate(p.actualCompletion) ?? parseDate(p.targetCompletion) ?? today;
          const clamped = end < start ? start : end;
          return { p, start, end: clamped, bands: bandsFor(p, clamped) };
        })
        .filter((x): x is Dated => x !== null),
    [projects, today],
  );

  const { rangeStart, days, totalWidth, todayOffsetPx, gridBackground, monthSegments } =
    useMemo(() => {
      const dataMinStart =
        dated.length > 0 ? new Date(Math.min(...dated.map((d) => d.start.getTime()))) : today;
      const dataMaxEnd =
        dated.length > 0 ? new Date(Math.max(...dated.map((d) => d.end.getTime()))) : today;

      const rangeStart = startOfMonth(
        new Date(Math.min(dataMinStart.getTime(), addMonths(today, -PAST_PAD_MONTHS).getTime())),
      );
      const rangeEnd = endOfMonth(
        new Date(Math.max(dataMaxEnd.getTime(), addMonths(today, FUTURE_PAD_MONTHS).getTime())),
      );

      const days = eachDayOfInterval({ start: rangeStart, end: rangeEnd });
      const totalWidth = days.length * DAY_WIDTH;
      const todayOffsetPx = differenceInCalendarDays(today, rangeStart) * DAY_WIDTH;

      // Weekend shading + day hairlines as one repeating gradient (Sat/Sun band
      // phase-shifted to land on the real weekend columns), so the same texture
      // can be reused verbatim on the header and the body background layer.
      const firstSatOffset = (6 - rangeStart.getDay() + 7) % 7;
      const weekendStart = firstSatOffset * DAY_WIDTH;
      const weekendEnd = (firstSatOffset + 2) * DAY_WIDTH;
      const cycle = 7 * DAY_WIDTH;
      const gridBackground = [
        `repeating-linear-gradient(to right, transparent 0, transparent ${weekendStart}px, var(--surface-sub) ${weekendStart}px, var(--surface-sub) ${weekendEnd}px, transparent ${weekendEnd}px, transparent ${cycle}px)`,
        `repeating-linear-gradient(to right, var(--divider) 0, var(--divider) 1px, transparent 1px, transparent ${DAY_WIDTH}px)`,
      ].join(", ");

      // Month boundaries — variable-length, so rendered as sparse absolute
      // dividers/labels rather than folded into the repeating gradient above.
      const monthSegments: { label: string; offsetPx: number; widthPx: number }[] = [];
      let cursor = 0;
      while (cursor < days.length) {
        const first = days[cursor];
        let count = 0;
        while (cursor < days.length && format(days[cursor], "yyyy-MM") === format(first, "yyyy-MM")) {
          cursor++;
          count++;
        }
        monthSegments.push({
          label: format(first, "MMMM yyyy"),
          offsetPx: (cursor - count) * DAY_WIDTH,
          widthPx: count * DAY_WIDTH,
        });
      }

      return { rangeStart, days, totalWidth, todayOffsetPx, gridBackground, monthSegments };
    }, [dated, today]);

  /**
   * The horizontal slice of the chart currently on screen, in chart
   * coordinates. The name column is sticky at the scrollport's left edge and
   * opaque, so content to its left is not merely off-screen, it is covered —
   * which is what turned a scrolled band's label into a fragment of a word.
   *
   * CSS sticky slides a label along its band, but the browser clamps it to the
   * band's own box: once a band's visible slice is narrower than its label,
   * sticky pushes the label as far as it can and the rest stays hidden behind
   * the name column. Knowing where the window is lets a band that cannot show
   * its whole label show none of it instead.
   */
  const [view, setView] = useState({ from: 0, to: 0 });
  const syncView = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Chart x and scrollLeft share an origin: the sticky name column occupies
    // the first NAME_COL_WIDTH px of the scrollport, and the chart div starts
    // exactly there, so content at x == scrollLeft sits at its right edge.
    setView({ from: el.scrollLeft, to: el.scrollLeft + el.clientWidth - NAME_COL_WIDTH });
  }, []);

  useEffect(() => {
    syncView();
    window.addEventListener("resize", syncView);
    return () => window.removeEventListener("resize", syncView);
  }, [syncView, totalWidth]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollLeft = Math.max(0, todayOffsetPx - el.clientWidth * 0.2);
    syncView();
    // Only on mount / range change — not on every re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalWidth]);

  if (dated.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No projects have a start date yet — dates are set when a project is scheduled.
      </p>
    );
  }

  const pxOffset = (d: Date) => differenceInCalendarDays(d, rangeStart) * DAY_WIDTH;

  // Group by property when the view spans the whole portfolio; a single
  // property already reads as one flat group.
  const groups = new Map<number, { label: string; rows: Dated[] }>();
  for (const d of dated) {
    const g = groups.get(d.p.propertyId);
    if (g) g.rows.push(d);
    else groups.set(d.p.propertyId, { label: d.p.propertyName, rows: [d] });
  }
  const sortedGroups = [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));

  return (
    <div
      ref={scrollRef}
      onScroll={syncView}
      className="min-h-[600px] max-h-[70vh] overflow-auto rounded-card border border-border bg-card"
    >
      <div style={{ width: NAME_COL_WIDTH + totalWidth }}>
        {/* Header: sticky top; corner cell inside is sticky left (frozen corner) */}
        <div className="sticky top-0 z-20 flex border-b border-border bg-card">
          <div
            className="sticky left-0 z-30 shrink-0 border-r border-border bg-card"
            style={{ width: NAME_COL_WIDTH }}
          />
          <div style={{ width: totalWidth }}>
            <div className="relative h-6" style={{ backgroundImage: gridBackground }}>
              {monthSegments.map((m) => (
                <div
                  key={m.label}
                  className="absolute top-0 h-6 truncate border-l border-border pl-1.5 text-xs font-semibold text-navy"
                  style={{ left: m.offsetPx, width: m.widthPx }}
                >
                  {m.label}
                </div>
              ))}
            </div>
            <div className="relative flex h-6" style={{ backgroundImage: gridBackground }}>
              {days.map((d) => (
                <div
                  key={d.toISOString()}
                  className={cn(
                    "shrink-0 text-center text-[11px] leading-6",
                    d.getDay() === 0 || d.getDay() === 6
                      ? "text-text-faint"
                      : "text-muted-foreground",
                  )}
                  style={{ width: DAY_WIDTH }}
                >
                  {format(d, "d")}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="relative">
          <div
            className="pointer-events-none absolute inset-y-0"
            style={{ left: NAME_COL_WIDTH, width: totalWidth, backgroundImage: gridBackground }}
          />
          {monthSegments.map((m) => (
            <div
              key={m.label}
              className="pointer-events-none absolute inset-y-0 w-px bg-border"
              style={{ left: NAME_COL_WIDTH + m.offsetPx }}
            />
          ))}
          <div
            className="pointer-events-none absolute inset-y-0 z-10 w-0.5 bg-alert"
            style={{ left: NAME_COL_WIDTH + todayOffsetPx }}
            title="Today"
          />

          <div className="relative">
            {sortedGroups.map((g) => (
              <div key={g.label}>
                <div className="flex border-b border-divider bg-surface-sub">
                  <div
                    className="sticky left-0 z-10 shrink-0 bg-surface-sub px-3 py-1.5 text-sm font-bold text-navy"
                    style={{ width: NAME_COL_WIDTH }}
                  >
                    {g.label}
                  </div>
                  <div style={{ width: totalWidth }} />
                </div>
                {g.rows.map((d) => (
                  <div
                    key={d.p.id}
                    className="flex border-b border-divider hover:bg-muted/50"
                  >
                    <div
                      className="sticky left-0 z-10 flex shrink-0 items-center truncate border-r border-border bg-card px-3 py-2"
                      style={{ width: NAME_COL_WIDTH }}
                    >
                      <Link
                        href={`/properties/${d.p.propertySlug}/projects/${projectSlug(d.p)}`}
                        className="truncate text-sm font-medium text-navy hover:underline"
                      >
                        {d.p.name}
                      </Link>
                      {/* Only when it adds something. "Unit 001 Interior · Unit
                          001" says the same thing twice; a project named
                          "Deluxe Turn" still needs to say which unit. */}
                      {d.p.unitLabel && !d.p.name.includes(d.p.unitLabel) && (
                        <span className="ml-1.5 shrink-0 text-xs text-muted-foreground">
                          {d.p.unitLabel}
                        </span>
                      )}
                    </div>
                    <div className="relative" style={{ width: totalWidth }}>
                      {/* The full extent, behind the bands. A project whose plan
                          covers only part of its span still shows how long it
                          runs, and the gap reads as "not dated yet" rather than
                          as the job being shorter than it is. */}
                      <div
                        className="absolute top-1/2 h-6 -translate-y-1/2 rounded-[3px] bg-track"
                        style={{
                          left: pxOffset(d.start),
                          width: Math.max(DAY_WIDTH, pxOffset(d.end) - pxOffset(d.start) + DAY_WIDTH),
                        }}
                        title={barTitle(d.p)}
                      />
                      {d.bands.map((b, i) => {
                        const style = BAND_STYLE[b.key];
                        const width = Math.max(
                          DAY_WIDTH,
                          pxOffset(b.to) - pxOffset(b.from) + DAY_WIDTH,
                        );
                        // The bands abut exactly, so rounding each one notched
                        // every join and the bar read as a row of loose pills.
                        // Only the two ends of the WHOLE bar are round.
                        const first = i === 0;
                        const last = i === d.bands.length - 1;
                        return (
                          <div
                            key={b.key}
                            className={cn(
                              "absolute top-1/2 flex h-6 -translate-y-1/2 items-center overflow-clip px-2 text-[11px] font-medium whitespace-nowrap",
                              first && "rounded-l-[3px]",
                              last && "rounded-r-[3px]",
                              style.bg,
                              style.text,
                              // The phase the project is REALLY in, against the
                              // band that planned for it. An inset rule rather
                              // than a ring: a ring on one band per row is an
                              // outline that looks like a mistake on every other
                              // row, and it changed the bar's silhouette.
                              b.key === d.p.phase && "shadow-[inset_0_-2px_0_0_var(--navy)]",
                            )}
                            style={{ left: pxOffset(b.from), width }}
                            title={`${phaseLabel(b.key)} · ${b.from.toISOString().slice(0, 10)} → ${b.to
                              .toISOString()
                              .slice(0, 10)}`}
                          >
                            {/* Only where the band fits the WHOLE word. A flat
                                threshold ellipsised "Pre-Construction" at the
                                same width that comfortably held "In Process",
                                and a clipped word is worse than no word.

                                Sticky so a band running off the left edge still
                                says what it is: the label slides along inside
                                its own band, pinned just clear of the name
                                column, and the browser clamps it to the band's
                                own box so it can never wander into the next
                                phase. The band clips with overflow-CLIP, not
                                overflow-hidden: clip contains a label whose font
                                loaded wider than measured, but does not make the
                                band a scroll container, which hidden would — and
                                then the label would never move. */}
                            {(() => {
                              // Measured against the part of the band you can
                              // actually see, not its full width. A band running
                              // off the left edge keeps its label — sticky slides
                              // it along — right up until the sliver left on
                              // screen is too small to hold the word, at which
                              // point showing none of it beats showing "ction".
                              const from = Math.max(pxOffset(b.from), view.from);
                              const to = Math.min(pxOffset(b.to) + DAY_WIDTH, view.to);
                              return to - from >= fitsLabel(b.key) ? (
                                <span className="sticky" style={{ left: NAME_COL_WIDTH + 8 }}>
                                  {phaseLabel(b.key)}
                                </span>
                              ) : null;
                            })()}
                          </div>
                        );
                      })}
                      {d.bands.length === 0 && (
                        <div
                          className="absolute top-1/2 flex h-6 -translate-y-1/2 items-center rounded border border-dashed border-ink-100 px-2 text-[11px] text-ink-300"
                          style={{
                            left: pxOffset(d.start),
                            width: Math.max(
                              DAY_WIDTH,
                              pxOffset(d.end) - pxOffset(d.start) + DAY_WIDTH,
                            ),
                          }}
                          title={barTitle(d.p)}
                        >
                          <span className="truncate">No phase dates</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* One hue in four steps needs one line to say which way it runs. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1 pt-2.5 text-[11px] text-muted-foreground">
        {PROJECT_PHASES.map((phase) => (
          <span key={phase.key} className="flex items-center gap-1.5">
            <span
              className={cn("h-2 w-4 rounded-[2px]", BAND_STYLE[phase.key].bg)}
              aria-hidden
            />
            {phase.label}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-4 rounded-[2px] bg-track" aria-hidden />
          Not dated yet
        </span>
      </div>
    </div>
  );
}

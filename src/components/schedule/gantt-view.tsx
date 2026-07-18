"use client";

import { useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import {
  addMonths,
  differenceInCalendarDays,
  eachDayOfInterval,
  endOfMonth,
  format,
  startOfMonth,
} from "date-fns";
import { stageLabel } from "@/lib/stages";
import { cn } from "@/lib/utils";
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

type Dated = { p: ScheduleProject; start: Date; end: Date };

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
          const start = parseDate(p.startDate) ?? parseDate(p.preWalkDate);
          if (!start) return null;
          const end = parseDate(p.completeDate) ?? parseDate(p.targetCompletionDate) ?? today;
          return { p, start, end: end < start ? start : end };
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

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollLeft = Math.max(0, todayOffsetPx - el.clientWidth * 0.2);
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
      className="max-h-[70vh] overflow-auto rounded-card border border-border bg-card"
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
                        href={`/properties/${d.p.propertyId}/projects/${d.p.id}`}
                        className="truncate text-sm font-medium text-navy hover:underline"
                      >
                        {d.p.name}
                      </Link>
                      {d.p.unitLabel && (
                        <span className="ml-1.5 shrink-0 text-xs text-muted-foreground">
                          {d.p.unitLabel}
                        </span>
                      )}
                    </div>
                    <div className="relative" style={{ width: totalWidth }}>
                      <div
                        className="absolute top-1/2 flex h-6 -translate-y-1/2 items-center rounded bg-navy px-2 text-[11px] font-medium whitespace-nowrap text-white"
                        style={{
                          left: pxOffset(d.start),
                          width: Math.max(DAY_WIDTH, pxOffset(d.end) - pxOffset(d.start) + DAY_WIDTH),
                        }}
                        title={`${d.p.startDate ?? d.p.preWalkDate} → ${d.p.completeDate ?? d.p.targetCompletionDate ?? "in progress"}`}
                      >
                        <span className="truncate">{stageLabel(d.p.stage)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

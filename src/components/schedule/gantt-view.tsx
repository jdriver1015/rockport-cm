"use client";

import Link from "next/link";
import { differenceInCalendarDays } from "date-fns";
import { stageLabel } from "@/lib/stages";
import type { ScheduleProject } from "@/lib/schedule-data";

function parseDate(s: string | null): Date | null {
  if (!s) return null;
  const d = new Date(`${s}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

type Dated = { p: ScheduleProject; start: Date; end: Date };

export function GanttView({ projects }: { projects: ScheduleProject[] }) {
  const today = new Date();
  const dated = projects
    .map((p) => {
      const start = parseDate(p.startDate) ?? parseDate(p.preWalkDate);
      if (!start) return null;
      const end =
        parseDate(p.completeDate) ?? parseDate(p.targetCompletionDate) ?? today;
      return { p, start, end: end < start ? start : end };
    })
    .filter((x): x is Dated => x !== null);

  if (dated.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No projects have a start date yet — dates are set when a project is scheduled.
      </p>
    );
  }

  const min = new Date(Math.min(...dated.map((d) => d.start.getTime())));
  const max = new Date(Math.max(...dated.map((d) => d.end.getTime())));
  const span = Math.max(1, differenceInCalendarDays(max, min));
  const pct = (d: Date) => (differenceInCalendarDays(d, min) / span) * 100;

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
    <div className="space-y-5">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{min.toLocaleDateString("en-US", { month: "short", year: "numeric" })}</span>
        <span>{max.toLocaleDateString("en-US", { month: "short", year: "numeric" })}</span>
      </div>
      {sortedGroups.map((g) => (
        <div key={g.label} className="space-y-1.5">
          <h3 className="text-sm font-bold text-navy">{g.label}</h3>
          {g.rows.map((d) => (
            <div
              key={d.p.id}
              className="grid grid-cols-[minmax(9rem,16rem)_1fr] items-center gap-3"
            >
              <Link
                href={`/properties/${d.p.propertyId}/projects/${d.p.id}`}
                className="truncate text-sm font-medium text-navy hover:underline"
              >
                {d.p.name}
                {d.p.unitLabel && (
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                    {d.p.unitLabel}
                  </span>
                )}
              </Link>
              <div className="relative h-6 rounded bg-paper">
                <div
                  className="absolute top-0 flex h-6 items-center rounded bg-navy px-2 text-[11px] font-medium text-white"
                  style={{
                    left: `${pct(d.start)}%`,
                    width: `${Math.max(2, pct(d.end) - pct(d.start))}%`,
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
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ScheduleProject } from "@/lib/schedule-data";

type Chip = {
  label: "Pre-walk" | "Start" | "Target" | "Complete";
  project: ScheduleProject;
};

const CHIP_COLOR: Record<Chip["label"], string> = {
  "Pre-walk": "bg-text-faint",
  Start: "bg-info",
  Target: "bg-pending",
  Complete: "bg-positive",
};

function buildDayMap(projects: ScheduleProject[]): Map<string, Chip[]> {
  const map = new Map<string, Chip[]>();
  function add(date: string | null, label: Chip["label"], project: ScheduleProject) {
    if (!date) return;
    (map.get(date) ?? map.set(date, []).get(date)!).push({ label, project });
  }
  for (const p of projects) {
    add(p.preWalkDate, "Pre-walk", p);
    add(p.startDate, "Start", p);
    add(p.targetCompletionDate, "Target", p);
    add(p.completeDate, "Complete", p);
  }
  return map;
}

const MAX_CHIPS_PER_DAY = 3;

export function CalendarView({ projects }: { projects: ScheduleProject[] }) {
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const dayMap = buildDayMap(projects);

  const gridStart = startOfWeek(startOfMonth(month));
  const gridEnd = endOfWeek(endOfMonth(month));
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-navy">{format(month, "MMMM yyyy")}</h2>
        <div className="flex gap-1">
          <Button variant="outline" size="icon-sm" onClick={() => setMonth((m) => subMonths(m, 1))}>
            <ChevronLeft className="size-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setMonth(startOfMonth(new Date()))}>
            Today
          </Button>
          <Button variant="outline" size="icon-sm" onClick={() => setMonth((m) => addMonths(m, 1))}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-card border border-border bg-border text-xs">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="bg-surface-sub px-2 py-1.5 text-center font-semibold text-text-faint uppercase">
            {d}
          </div>
        ))}
        {days.map((day) => {
          const iso = format(day, "yyyy-MM-dd");
          const chips = dayMap.get(iso) ?? [];
          const inMonth = isSameMonth(day, month);
          return (
            <div
              key={iso}
              className={cn(
                "min-h-[6.5rem] bg-card p-1.5",
                !inMonth && "bg-surface-sub/50 text-text-faint",
              )}
            >
              <div
                className={cn(
                  "mb-1 inline-flex size-5 items-center justify-center rounded-full text-xs",
                  isToday(day) && "bg-navy font-semibold text-white",
                )}
              >
                {format(day, "d")}
              </div>
              <div className="space-y-0.5">
                {chips.slice(0, MAX_CHIPS_PER_DAY).map((c, i) => (
                  <Link
                    key={i}
                    href={`/properties/${c.project.propertyId}/projects/${c.project.id}`}
                    title={`${c.label} — ${c.project.propertyName} · ${c.project.name}`}
                    className="flex items-center gap-1 truncate rounded px-1 py-0.5 text-[11px] hover:bg-surface-sub"
                  >
                    <span className={cn("size-1.5 shrink-0 rounded-full", CHIP_COLOR[c.label])} />
                    <span className="truncate">{c.project.name}</span>
                  </Link>
                ))}
                {chips.length > MAX_CHIPS_PER_DAY && (
                  <div className="px-1 text-[11px] text-text-faint">
                    +{chips.length - MAX_CHIPS_PER_DAY} more
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        {(Object.keys(CHIP_COLOR) as Chip["label"][]).map((label) => (
          <span key={label} className="inline-flex items-center gap-1.5">
            <span className={cn("size-1.5 rounded-full", CHIP_COLOR[label])} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

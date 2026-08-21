"use client";

import { StageDot } from "@/components/ui/stage-dot";
import { ClickableTableRow } from "@/components/ui/clickable-table-row";
import { TableCard } from "@/components/ui/table-card";
import {
  Table,
  TableBody,
  TableCell,
  TableGroupRow,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { projectSlug } from "@/lib/slug";
import type { ScheduleProject } from "@/lib/schedule-data";

type Milestone = {
  date: string;
  label: "Pre-walk" | "Start" | "Target completion" | "Complete";
  project: ScheduleProject;
};

function toMilestones(projects: ScheduleProject[]): Milestone[] {
  const out: Milestone[] = [];
  for (const p of projects) {
    if (p.preWalkDate) out.push({ date: p.preWalkDate, label: "Pre-walk", project: p });
    if (p.startDate) out.push({ date: p.startDate, label: "Start", project: p });
    if (p.targetCompletionDate)
      out.push({ date: p.targetCompletionDate, label: "Target completion", project: p });
    if (p.completeDate) out.push({ date: p.completeDate, label: "Complete", project: p });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

function monthKey(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function fmtDay(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

const DONE_PHASES = new Set(["complete"]);

export function AgendaView({ projects }: { projects: ScheduleProject[] }) {
  const milestones = toMilestones(projects);
  const todayIso = new Date().toISOString().slice(0, 10);

  if (milestones.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No scheduled phase dates yet — these are set as a project moves through its phases.
      </p>
    );
  }

  const groups: { month: string; rows: Milestone[] }[] = [];
  for (const m of milestones) {
    const key = monthKey(m.date);
    const last = groups[groups.length - 1];
    if (last && last.month === key) last.rows.push(m);
    else groups.push({ month: key, rows: [m] });
  }

  return (
    <TableCard>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Property</TableHead>
            <TableHead>Project</TableHead>
            <TableHead>Phase</TableHead>
            <TableHead>Phase</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.map((g) => (
            <TableRowsForMonth
              key={g.month}
              month={g.month}
              rows={g.rows}
              todayIso={todayIso}
            />
          ))}
        </TableBody>
      </Table>
    </TableCard>
  );
}

function TableRowsForMonth({
  month,
  rows,
  todayIso,
}: {
  month: string;
  rows: Milestone[];
  todayIso: string;
}) {
  return (
    <>
      <TableGroupRow label={month} count={rows.length} colSpan={5} />
      {rows.map((m, i) => {
        const overdue =
          m.label === "Target completion" &&
          m.date < todayIso &&
          !DONE_PHASES.has(m.project.phase);
        return (
          <ClickableTableRow
            key={`${m.project.id}-${m.label}-${i}`}
            href={`/properties/${m.project.propertySlug}/projects/${projectSlug(m.project)}`}
          >
            <TableCell className={cn(overdue && "font-semibold text-alert")}>
              {fmtDay(m.date)}
              {overdue && <span className="ml-1.5 text-xs">overdue</span>}
            </TableCell>
            <TableCell className="text-muted-foreground">{m.project.propertyName}</TableCell>
            <TableCell>
              <span className="font-medium text-navy">{m.project.name}</span>
              {m.project.unitLabel && (
                <span className="ml-1.5 text-xs text-muted-foreground">
                  {m.project.unitLabel}
                </span>
              )}
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">{m.label}</TableCell>
            <TableCell>
              <StageDot phase={m.project.phase} />
            </TableCell>
          </ClickableTableRow>
        );
      })}
    </>
  );
}

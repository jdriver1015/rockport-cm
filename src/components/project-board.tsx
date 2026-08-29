"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AmountCell } from "@/components/ui/amount-cell";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { PhaseDot } from "@/components/ui/stage-dot";
import { GanttView } from "@/components/schedule/gantt-view";
import type { ScheduleProject } from "@/lib/schedule-data";
import { TableCard } from "@/components/ui/table-card";
import { isInteractiveTarget } from "@/components/ui/clickable-table-row";
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
import { fmtDate, money } from "@/lib/format";
import { PROJECT_PHASES, phaseIndex } from "@/lib/stages";
import { DIVISIONS } from "@/lib/divisions";
import type { ScheduleHealth } from "@/lib/target-slip";
import { projectSlug } from "@/lib/slug";

export type BoardProject = {
  id: number;
  name: string;
  phase: string;
  budget: number;
  committed: number;
  jtd: number;
  startDate: string | null;
  completeDate: string | null;
  division: string | null;
  categoryLabel: string;
  lineItem: string;
  /** Slip against the original plan — see readScheduleHealth. */
  health: ScheduleHealth;
  /** 'unit' or 'common'. Decides how the scope was priced, nothing after that. */
  kind: string;
  /** "Unit 001" on a turn, null on common-area work. */
  unitLabel: string | null;
  /** The renovation type a turn was priced from. Null on common-area work. */
  renovationType: string | null;
};

/** What each kind is called where a person reads it. */
export const KIND_LABEL: Record<string, string> = {
  unit: "Unit interior",
  common: "Common area",
};

type ViewMode = "table" | "gantt";
type GroupBy = "phase" | "kind" | "division" | "category" | "none";
type SortKey = "name" | "budget" | "committed" | "jtd" | "phase" | "schedule";
type Dir = "asc" | "desc";

const VIEWS: { key: ViewMode; label: string }[] = [
  { key: "table", label: "Table" },
  { key: "gantt", label: "Gantt" },
];

function isView(v: string | undefined): v is ViewMode {
  return v === "table" || v === "gantt";
}
function isGroup(v: string | undefined): v is GroupBy {
  return (
    v === "phase" || v === "kind" || v === "division" || v === "category" || v === "none"
  );
}
function isSort(v: string | undefined): v is SortKey {
  return (
    v === "name" ||
    v === "budget" ||
    v === "committed" ||
    v === "jtd" ||
    v === "phase" ||
    v === "schedule"
  );
}

export function ProjectBoard({
  ganttProjects,
  projects,
  propertySlug,
  initialView,
  initialGroup,
  initialSort,
  initialDir,
  initialQuery,
}: {
  /**
   * The same rows the Schedule tab's Gantt draws, scoped to this property.
   *
   * The board keeps its own BoardProject shape for the table — budgets,
   * committed cost, variance — and the Gantt needs target phasing and slip,
   * which is a different read. Rather than widen one to cover both, the Gantt
   * gets its own rows and the toolbar filters them by id.
   */
  ganttProjects: ScheduleProject[];
  projects: BoardProject[];
  propertySlug: string;
  initialView?: string;
  initialGroup?: string;
  initialSort?: string;
  initialDir?: string;
  initialQuery?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [view, setView] = useState<ViewMode>(isView(initialView) ? initialView : "table");
  const [group, setGroup] = useState<GroupBy>(isGroup(initialGroup) ? initialGroup : "phase");
  const [sort, setSort] = useState<SortKey>(isSort(initialSort) ? initialSort : "name");
  const [dir, setDir] = useState<Dir>(initialDir === "desc" ? "desc" : "asc");
  const [query, setQuery] = useState(initialQuery ?? "");

  // Keep the URL in sync so a view is shareable and survives reload.
  function syncUrl(next: Partial<Record<string, string>>) {
    const params = new URLSearchParams(searchParams.toString());
    const state: Record<string, string> = {
      view,
      group,
      sort,
      dir,
      q: query,
      ...next,
    };
    const defaults: Record<string, string> = {
      view: "table",
      group: "phase",
      sort: "name",
      dir: "asc",
      q: "",
    };
    for (const [k, v] of Object.entries(state)) {
      if (!v || v === defaults[k]) params.delete(k);
      else params.set(k, v);
    }
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  const filtered = projects.filter((p) => {
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      const hay =
        `${p.name} ${p.lineItem} ${p.categoryLabel} ${p.unitLabel ?? ""} ${p.renovationType ?? ""} ${KIND_LABEL[p.kind] ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    let cmp = 0;
    switch (sort) {
      case "name":
        cmp = a.name.localeCompare(b.name);
        break;
      case "budget":
        cmp = a.budget - b.budget;
        break;
      case "committed":
        cmp = a.committed - b.committed;
        break;
      case "jtd":
        cmp = a.jtd - b.jtd;
        break;
      case "phase":
        cmp = phaseIndex(a.phase) - phaseIndex(b.phase);
        break;
      case "schedule":
        // Worst first on descending, which is the direction anybody sorting by
        // schedule actually wants: the top of the list is the work to do today.
        cmp = a.health.slipDays - b.health.slipDays;
        break;
    }
    return dir === "asc" ? cmp : -cmp;
  });

  const groups = buildGroups(sorted, group);
  // The Gantt draws from the schedule rows, but the toolbar above it still
  // decides what is on screen — so it gets the same filtered set the table
  // would have shown, matched by id.
  const visibleIds = new Set(sorted.map((p) => p.id));

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        {/* View switcher */}
        <SegmentedControl
          options={VIEWS.map((v) => ({ key: v.key, label: v.label }))}
          value={view}
          onChange={(v) => {
            setView(v);
            syncUrl({ view: v });
          }}
        />

        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          Group
          <SelectBox
            value={group}
            onChange={(v) => {
              setGroup(v as GroupBy);
              syncUrl({ group: v });
            }}
            options={[
              ["phase", "Phase"],
              ["kind", "Type"],
              ["division", "Division"],
              ["category", "Category"],
              ["none", "None"],
            ]}
          />
        </label>

        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          Sort
          <SelectBox
            value={sort}
            onChange={(v) => {
              setSort(v as SortKey);
              syncUrl({ sort: v });
            }}
            options={[
              ["name", "Name"],
              ["budget", "Budgeted"],
              ["committed", "Committed cost"],
              ["jtd", "Completed"],
              ["phase", "Phase"],
              ["schedule", "Schedule"],
            ]}
          />
          <button
            type="button"
            onClick={() => {
              const next = dir === "asc" ? "desc" : "asc";
              setDir(next);
              syncUrl({ dir: next });
            }}
            className="rounded-md border border-border px-2 py-1 text-sm text-muted-foreground hover:text-foreground"
            title={dir === "asc" ? "Ascending" : "Descending"}
          >
            {dir === "asc" ? "↑" : "↓"}
          </button>
        </label>

        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            syncUrl({ q: e.target.value });
          }}
          placeholder="Search projects…"
          className="ml-auto h-8 w-48 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
        />
      </div>

      {projects.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No projects yet — add the first one with “New project”.
        </p>
      ) : view === "table" ? (
        <TableView groups={groups} propertySlug={propertySlug} groupBy={group} />
      ) : (
        /* The Schedule tab's Gantt, not a second one. This used to draw its own
           bars from startDate and completeDate — actuals only — so a project
           that had not begun showed nothing at all, which is most of them. That
           one understands phase bands, target phasing and slip. */
        <GanttView
          projects={ganttProjects.filter((g) => visibleIds.has(g.id))}
          showPropertyHeadings={false}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

type Group = { key: string; label: string; projects: BoardProject[] };

function buildGroups(projects: BoardProject[], groupBy: GroupBy): Group[] {
  if (groupBy === "none") {
    return [{ key: "all", label: "All projects", projects }];
  }
  if (groupBy === "phase") {
    return PROJECT_PHASES.map((ph) => ({
      key: ph.key,
      label: ph.label,
      projects: projects.filter((p) => p.phase === ph.key),
    }));
  }
  if (groupBy === "kind") {
    // Unit turns first: they are the bulk of the work and the ones a property
    // manager scans for.
    return ["unit", "common"]
      .map((k) => ({
        key: k,
        label: KIND_LABEL[k] ?? k,
        projects: projects.filter((p) => p.kind === k),
      }))
      .filter((g) => g.projects.length > 0);
  }
  if (groupBy === "division") {
    const groups: Group[] = DIVISIONS.map((d) => ({
      key: d.key,
      label: d.label,
      projects: projects.filter((p) => (p.division ?? null) === d.key),
    }));
    const unassigned = projects.filter((p) => !p.division);
    if (unassigned.length) groups.push({ key: "unassigned", label: "Unassigned", projects: unassigned });
    return groups;
  }
  // category
  const labels = Array.from(new Set(projects.map((p) => p.categoryLabel))).sort((a, b) =>
    a.localeCompare(b),
  );
  return labels.map((label) => ({
    key: label,
    label,
    projects: projects.filter((p) => p.categoryLabel === label),
  }));
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function SelectBox({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 rounded-md border border-input bg-transparent px-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      {options.map(([v, label]) => (
        <option key={v} value={v}>
          {label}
        </option>
      ))}
    </select>
  );
}

function VarianceCell({ budget, actual }: { budget: number; actual: number }) {
  if (!actual) return <span className="block text-right font-semibold tabular-nums text-ink-100">—</span>;
  const variance = budget - actual;
  const formatted = money(Math.abs(variance));
  if (formatted === "—") return <span className="block text-right font-semibold tabular-nums text-ink-100">—</span>;
  const isPositive = variance >= 0;
  return (
    <span
      className={cn(
        "block text-right font-semibold tabular-nums",
        isPositive ? "text-positive" : "text-red-600",
      )}
    >
      {isPositive ? `+${formatted}` : `-${formatted}`}
    </span>
  );
}

/**
 * Is this project in trouble, and when does it land.
 *
 * Slip against the ORIGINAL plan, not days to the next milestone. A missed
 * target is pushed to today, so days-to-next can never read negative and every
 * project reports zero — the metric is destroyed by the mechanic that keeps the
 * plan honest. Slip accumulates instead, which is what a scheduler reads off
 * total float: how far has the finish moved from what we committed to.
 */
const STATUS_STYLE: Record<ScheduleHealth["status"], string> = {
  on_time: "bg-positive-bg text-positive",
  slipping: "bg-alert-bg/60 text-pending",
  late: "bg-alert-bg text-alert",
  unknown: "bg-muted text-text-faint",
};

function ScheduleCell({ health }: { health: ScheduleHealth }) {
  const { slipDays, baselineDays, forecastFinish, status } = health;

  const label =
    status === "unknown"
      ? "No plan"
      : slipDays <= 0
        ? // "On time" rather than "0d" — zero is a number you have to interpret.
          "On time"
        : `${slipDays} day${slipDays === 1 ? "" : "s"} late`;

  const share = baselineDays > 0 ? Math.round((slipDays / baselineDays) * 100) : null;

  return (
    <div className="min-w-0">
      <span
        className={cn(
          "inline-block rounded-control px-1.5 py-0.5 text-[12px] font-medium whitespace-nowrap",
          STATUS_STYLE[status],
        )}
        title={
          status === "unknown"
            ? "No target finish set for this project"
            : slipDays > 0 && share !== null
              ? `${slipDays} working days later than first planned — ${share}% of a ${baselineDays}-day plan`
              : "The finish has not moved since it was first planned"
        }
      >
        {label}
      </span>
      {forecastFinish && (
        <div className="truncate text-[11px] text-muted-foreground">
          finishing {fmtDate(forecastFinish)}
        </div>
      )}
    </div>
  );
}

function ProjectLink({
  project,
  propertySlug,
  className,
  interactive = true,
}: {
  project: BoardProject;
  propertySlug: string;
  className?: string;
  /** False inside a row that's already click-to-navigate — the link's own hover
   * cue would otherwise make it look like the only clickable spot in the row. */
  interactive?: boolean;
}) {
  return (
    <Link
      href={`/properties/${propertySlug}/projects/${projectSlug(project)}`}
      className={cn("font-medium text-navy", interactive && "hover:text-link hover:underline", className)}
    >
      {project.name}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Table view
// ---------------------------------------------------------------------------

/**
 * The line under a project's name, or nothing.
 *
 * A turn says which renovation type priced it; a common-area job says nothing,
 * because its categories live on its scope lines and naming one here would be
 * the same lie the project-level cost code was. Both go quiet when the list is
 * already grouped by type.
 */
function subtitleFor(p: BoardProject, groupBy: GroupBy): string | null {
  if (groupBy === "kind") return p.kind === "unit" ? p.renovationType : null;
  if (p.kind !== "unit") return null;
  return p.renovationType ? `Unit interior · ${p.renovationType}` : "Unit interior";
}

function TableView({
  groups,
  propertySlug,
  groupBy,
}: {
  groups: Group[];
  propertySlug: string;
  groupBy: GroupBy;
}) {
  const router = useRouter();
  const shown = groups.filter((g) => g.projects.length > 0);
  if (shown.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No projects match.</p>;
  }
  // One fixed-layout table with full-width group-header rows so every group's
  // columns line up. `table-fixed` + explicit header widths keep them aligned.
  return (
    <TableCard>
      <Table className="table-fixed">
        <TableHeader>
          <TableRow>
            <TableHead className="w-[24%]">Project</TableHead>
            <TableHead className="w-[15%]">Schedule</TableHead>
            <TableHead className="w-[10%]">Est. Start</TableHead>
            <TableHead className="w-[13%] text-right">Planned Cost</TableHead>
            <TableHead className="w-[13%] text-right">Committed</TableHead>
            <TableHead className="w-[13%] text-right">Reconciled Cost</TableHead>
            <TableHead className="w-[12%] text-right">Variance</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {shown.map((g) => (
            <Fragment key={g.key}>
              <TableGroupRow label={g.label} count={g.projects.length} colSpan={7} />
              {g.projects.map((p) => {
                // Never hide real spend: a project can have posted GL before its
                // contract amount was recorded, so Committed shows whichever is
                // larger — the signed contract or actual spend so far.
                const committed = Math.max(p.committed, p.jtd);
                return (
                  <TableRow
                    key={p.id}
                    onClick={(e) => {
                      if (isInteractiveTarget(e.target)) return;
                      router.push(`/properties/${propertySlug}/projects/${projectSlug(p)}`);
                    }}
                    className="cursor-pointer hover:bg-track"
                  >
                    <TableCell className="truncate">
                      {/* The phase as colour only. It cost a whole column and
                          the widest label in the table to say what a 7px dot
                          says here, and the group header names it outright when
                          grouped by phase. */}
                      <span className="flex min-w-0 items-center gap-2">
                        <PhaseDot phase={p.phase} />
                        <span className="min-w-0">
                          <ProjectLink
                            project={p}
                            propertySlug={propertySlug}
                            interactive={false}
                          />
                          {/* The renovation type a turn was priced from — the one
                              thing the separate Unit Upgrades table showed that
                              this list did not. Suppressed when already grouped
                              by type, where the header says it. */}
                          {subtitleFor(p, groupBy) && (
                            <span className="block truncate text-[11px] text-muted-foreground">
                              {subtitleFor(p, groupBy)}
                            </span>
                          )}
                        </span>
                      </span>
                    </TableCell>
                    <TableCell>
                      <ScheduleCell health={p.health} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{fmtDate(p.startDate)}</TableCell>
                    <TableCell>
                      <AmountCell value={p.budget} />
                    </TableCell>
                    <TableCell>
                      <AmountCell value={committed} />
                    </TableCell>
                    <TableCell>
                      <AmountCell value={p.jtd} positive />
                    </TableCell>
                    <TableCell>
                      <VarianceCell budget={p.budget} actual={p.jtd} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </Fragment>
          ))}
        </TableBody>
      </Table>
    </TableCard>
  );
}

// ---------------------------------------------------------------------------
// Kanban view
// ---------------------------------------------------------------------------

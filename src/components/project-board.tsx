"use client";

import { Fragment, useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { differenceInCalendarDays } from "date-fns";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { AmountCell } from "@/components/ui/amount-cell";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { StageDot } from "@/components/ui/stage-dot";
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
import { PROJECT_PHASES, phaseIndex, phaseLabel } from "@/lib/stages";
import { DIVISIONS } from "@/lib/divisions";
import { setProjectPhase } from "@/lib/actions/projects";
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
};

type ViewMode = "table" | "kanban" | "gantt";
type GroupBy = "phase" | "division" | "category" | "none";
type SortKey = "name" | "budget" | "committed" | "jtd" | "phase";
type Dir = "asc" | "desc";

const VIEWS: { key: ViewMode; label: string }[] = [
  { key: "table", label: "Table" },
  { key: "kanban", label: "Kanban" },
  { key: "gantt", label: "Gantt" },
];

function isView(v: string | undefined): v is ViewMode {
  return v === "table" || v === "kanban" || v === "gantt";
}
function isGroup(v: string | undefined): v is GroupBy {
  return v === "phase" || v === "division" || v === "category" || v === "none";
}
function isSort(v: string | undefined): v is SortKey {
  return v === "name" || v === "budget" || v === "committed" || v === "jtd" || v === "phase";
}

export function ProjectBoard({
  projects,
  propertySlug,
  initialView,
  initialGroup,
  initialSort,
  initialDir,
  initialQuery,
}: {
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

  const [pending, startTransition] = useTransition();
  const [optimistic, applyOptimistic] = useOptimistic(
    projects,
    (state: BoardProject[], move: { id: number; phase: string }) =>
      state.map((p) => (p.id === move.id ? { ...p, phase: move.phase } : p)),
  );

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

  const filtered = optimistic.filter((p) => {
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      const hay = `${p.name} ${p.lineItem} ${p.categoryLabel}`.toLowerCase();
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
    }
    return dir === "asc" ? cmp : -cmp;
  });

  const groups = buildGroups(sorted, group);

  function advancePhase(projectId: number, toPhase: string) {
    startTransition(async () => {
      applyOptimistic({ id: projectId, phase: toPhase });
      const fd = new FormData();
      fd.set("projectId", String(projectId));
      fd.set("toPhase", toPhase);
      const res = await setProjectPhase(fd);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      router.refresh();
    });
  }

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
        <TableView groups={groups} propertySlug={propertySlug} />
      ) : view === "kanban" ? (
        <KanbanView
          groups={groups}
          groupBy={group}
          propertySlug={propertySlug}
          pending={pending}
          onDropToPhase={advancePhase}
        />
      ) : (
        <GanttView groups={groups} propertySlug={propertySlug} />
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

function PhaseBadge({ phase }: { phase: string }) {
  return (
    <Badge variant="secondary" className="border border-border">
      {phaseLabel(phase)}
    </Badge>
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

function TableView({ groups, propertySlug }: { groups: Group[]; propertySlug: string }) {
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
            <TableHead className="w-[22%]">Project</TableHead>
            <TableHead className="w-[10%]">Phase</TableHead>
            <TableHead className="w-[11%]">Est. Start</TableHead>
            <TableHead className="w-[14%] text-right">Planned Cost</TableHead>
            <TableHead className="w-[14%] text-right">Committed</TableHead>
            <TableHead className="w-[15%] text-right">Reconciled Cost</TableHead>
            <TableHead className="w-[14%] text-right">Variance</TableHead>
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
                      <ProjectLink project={p} propertySlug={propertySlug} interactive={false} />
                    </TableCell>
                    <TableCell>
                      <StageDot phase={p.phase} />
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

function KanbanView({
  groups,
  groupBy,
  propertySlug,
  pending,
  onDropToPhase,
}: {
  groups: Group[];
  groupBy: GroupBy;
  propertySlug: string;
  pending: boolean;
  onDropToPhase: (projectId: number, toPhase: string) => void;
}) {
  const draggable = groupBy === "phase";
  const [dragOver, setDragOver] = useState<string | null>(null);

  return (
    <div>
      {!draggable && (
        <p className="mb-2 text-xs text-muted-foreground">
          Drag-to-move is available when grouped by Phase.
        </p>
      )}
      <div className="flex gap-3 overflow-x-auto pb-2">
        {groups.map((g) => (
          <div
            key={g.key}
            onDragOver={(e) => {
              if (!draggable) return;
              e.preventDefault();
              setDragOver(g.key);
            }}
            onDragLeave={() => setDragOver((k) => (k === g.key ? null : k))}
            onDrop={(e) => {
              if (!draggable) return;
              e.preventDefault();
              setDragOver(null);
              const pid = Number(e.dataTransfer.getData("text/plain"));
              if (pid) onDropToPhase(pid, g.key);
            }}
            className={cn(
              "flex w-64 shrink-0 flex-col rounded-lg border bg-muted",
              dragOver === g.key && "ring-2 ring-gold",
            )}
          >
            <div className="flex items-baseline justify-between border-b px-3 py-2">
              <h3 className="text-sm font-bold text-navy">{g.label}</h3>
              <span className="text-xs text-muted-foreground">{g.projects.length}</span>
            </div>
            <div className={cn("flex flex-col gap-2 p-2", pending && "opacity-70")}>
              {g.projects.map((p) => (
                <div
                  key={p.id}
                  draggable={draggable}
                  onDragStart={(e) => e.dataTransfer.setData("text/plain", String(p.id))}
                  className={cn(
                    "rounded-md border bg-card p-3 shadow-sm",
                    draggable && "cursor-grab active:cursor-grabbing",
                  )}
                >
                  <ProjectLink project={p} propertySlug={propertySlug} className="text-sm" />
                  <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                    {p.lineItem}
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-xs font-semibold tabular-nums text-navy">
                      {money(p.budget)}
                    </span>
                    {groupBy !== "phase" && <PhaseBadge phase={p.phase} />}
                  </div>
                </div>
              ))}
              {g.projects.length === 0 && (
                <p className="px-1 py-3 text-center text-xs text-muted-foreground">—</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Gantt view
// ---------------------------------------------------------------------------

function parseDate(s: string | null): Date | null {
  if (!s) return null;
  const d = new Date(`${s}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function GanttView({ groups, propertySlug }: { groups: Group[]; propertySlug: string }) {
  const today = new Date();
  const all = groups.flatMap((g) => g.projects);
  const dated = all
    .map((p) => {
      const start = parseDate(p.startDate);
      if (!start) return null;
      const end = parseDate(p.completeDate) ?? today;
      return { p, start, end: end < start ? start : end };
    })
    .filter((x): x is { p: BoardProject; start: Date; end: Date } => x !== null);

  if (dated.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No projects have a start date yet — dates are set when a project moves into “In Progress”.
      </p>
    );
  }

  const min = new Date(Math.min(...dated.map((d) => d.start.getTime())));
  const max = new Date(Math.max(...dated.map((d) => d.end.getTime())));
  const span = Math.max(1, differenceInCalendarDays(max, min));

  const pct = (d: Date) => (differenceInCalendarDays(d, min) / span) * 100;

  const shown = groups.filter((g) => g.projects.length > 0);

  return (
    <div className="space-y-5">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{min.toLocaleDateString("en-US", { month: "short", year: "numeric" })}</span>
        <span>{max.toLocaleDateString("en-US", { month: "short", year: "numeric" })}</span>
      </div>
      {shown.map((g) => (
        <div key={g.key} className="space-y-1.5">
          <h3 className="text-sm font-bold text-navy">{g.label}</h3>
          {g.projects.map((p) => {
            const d = dated.find((x) => x.p.id === p.id);
            return (
              <div key={p.id} className="grid grid-cols-[minmax(9rem,14rem)_1fr] items-center gap-3">
                <ProjectLink project={p} propertySlug={propertySlug} className="truncate text-sm" />
                <div className="relative h-6 rounded bg-track">
                  {d ? (
                    <div
                      className="absolute top-0 flex h-6 items-center rounded bg-navy px-2 text-[11px] font-medium text-white"
                      style={{
                        left: `${pct(d.start)}%`,
                        width: `${Math.max(2, pct(d.end) - pct(d.start))}%`,
                      }}
                      title={`${p.startDate} → ${p.completeDate ?? "in progress"}`}
                    >
                      <span className="truncate">{phaseLabel(p.phase)}</span>
                    </div>
                  ) : (
                    <span className="absolute left-2 top-1 text-[11px] text-muted-foreground">
                      no dates yet
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

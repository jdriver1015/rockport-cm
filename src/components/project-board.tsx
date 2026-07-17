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
import { money } from "@/lib/format";
import { PROJECT_STAGES, stageIndex, stageLabel } from "@/lib/stages";
import { DIVISIONS } from "@/lib/divisions";
import { setProjectStage } from "@/lib/actions/projects";

export type BoardProject = {
  id: number;
  name: string;
  kind: string;
  stage: string;
  budget: number;
  committed: number;
  jtd: number;
  startDate: string | null;
  completeDate: string | null;
  division: string | null;
  categoryLabel: string;
  lineItem: string;
  unitLabel: string | null;
};

type ViewMode = "table" | "kanban" | "gantt";
type GroupBy = "stage" | "division" | "category" | "none";
type SortKey = "name" | "budget" | "committed" | "jtd" | "stage";
type Dir = "asc" | "desc";
type KindFilter = "all" | "common" | "unit";

const VIEWS: { key: ViewMode; label: string }[] = [
  { key: "table", label: "Table" },
  { key: "kanban", label: "Kanban" },
  { key: "gantt", label: "Gantt" },
];

function isView(v: string | undefined): v is ViewMode {
  return v === "table" || v === "kanban" || v === "gantt";
}
function isGroup(v: string | undefined): v is GroupBy {
  return v === "stage" || v === "division" || v === "category" || v === "none";
}
function isSort(v: string | undefined): v is SortKey {
  return v === "name" || v === "budget" || v === "committed" || v === "jtd" || v === "stage";
}

export function ProjectBoard({
  projects,
  propertyId,
  initialView,
  initialGroup,
  initialSort,
  initialDir,
  initialKind,
  initialQuery,
}: {
  projects: BoardProject[];
  propertyId: number;
  initialView?: string;
  initialGroup?: string;
  initialSort?: string;
  initialDir?: string;
  initialKind?: string;
  initialQuery?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [view, setView] = useState<ViewMode>(isView(initialView) ? initialView : "table");
  const [group, setGroup] = useState<GroupBy>(isGroup(initialGroup) ? initialGroup : "stage");
  const [sort, setSort] = useState<SortKey>(isSort(initialSort) ? initialSort : "name");
  const [dir, setDir] = useState<Dir>(initialDir === "desc" ? "desc" : "asc");
  const [kind, setKind] = useState<KindFilter>(
    initialKind === "common" || initialKind === "unit" ? initialKind : "all",
  );
  const [query, setQuery] = useState(initialQuery ?? "");

  const [pending, startTransition] = useTransition();
  const [optimistic, applyOptimistic] = useOptimistic(
    projects,
    (state: BoardProject[], move: { id: number; stage: string }) =>
      state.map((p) => (p.id === move.id ? { ...p, stage: move.stage } : p)),
  );

  // Keep the URL in sync so a view is shareable and survives reload.
  function syncUrl(next: Partial<Record<string, string>>) {
    const params = new URLSearchParams(searchParams.toString());
    const state: Record<string, string> = {
      view,
      group,
      sort,
      dir,
      kind,
      q: query,
      ...next,
    };
    const defaults: Record<string, string> = {
      view: "table",
      group: "stage",
      sort: "name",
      dir: "asc",
      kind: "all",
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
    if (kind !== "all" && p.kind !== kind) return false;
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      const hay = `${p.name} ${p.lineItem} ${p.categoryLabel} ${p.unitLabel ?? ""}`.toLowerCase();
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
      case "stage":
        cmp = stageIndex(a.stage) - stageIndex(b.stage);
        break;
    }
    return dir === "asc" ? cmp : -cmp;
  });

  const groups = buildGroups(sorted, group);

  function advanceStage(projectId: number, toStage: string) {
    startTransition(async () => {
      applyOptimistic({ id: projectId, stage: toStage });
      const fd = new FormData();
      fd.set("projectId", String(projectId));
      fd.set("toStage", toStage);
      const res = await setProjectStage(fd);
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
              ["stage", "Stage"],
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
              ["committed", "Committed"],
              ["jtd", "Completed"],
              ["stage", "Stage"],
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

        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          Kind
          <SelectBox
            value={kind}
            onChange={(v) => {
              setKind(v as KindFilter);
              syncUrl({ kind: v });
            }}
            options={[
              ["all", "All"],
              ["common", "Common"],
              ["unit", "Unit"],
            ]}
          />
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
        <TableView groups={groups} propertyId={propertyId} />
      ) : view === "kanban" ? (
        <KanbanView
          groups={groups}
          groupBy={group}
          propertyId={propertyId}
          pending={pending}
          onDropToStage={advanceStage}
        />
      ) : (
        <GanttView groups={groups} propertyId={propertyId} />
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
  if (groupBy === "stage") {
    return PROJECT_STAGES.map((s) => ({
      key: s.key,
      label: s.label,
      projects: projects.filter((p) => p.stage === s.key),
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

function StageBadge({ stage }: { stage: string }) {
  return (
    <Badge variant="secondary" className="border border-border">
      {stageLabel(stage)}
    </Badge>
  );
}

function ProjectLink({
  project,
  propertyId,
  className,
}: {
  project: BoardProject;
  propertyId: number;
  className?: string;
}) {
  return (
    <Link
      href={`/properties/${propertyId}/projects/${project.id}`}
      className={cn("font-medium text-navy hover:text-gold-link hover:underline", className)}
    >
      {project.name}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Table view
// ---------------------------------------------------------------------------

function TableView({ groups, propertyId }: { groups: Group[]; propertyId: number }) {
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
            <TableHead className="w-[26%]">Project</TableHead>
            <TableHead className="w-[28%]">UW line item</TableHead>
            <TableHead className="w-[14%]">Stage</TableHead>
            <TableHead className="w-[11%] text-right">Budgeted</TableHead>
            <TableHead className="w-[11%] text-right">Committed</TableHead>
            <TableHead className="w-[10%] text-right">Completed</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {shown.map((g) => (
            <Fragment key={g.key}>
              <TableGroupRow label={g.label} count={g.projects.length} colSpan={6} />
              {g.projects.map((p) => (
                <TableRow
                  key={p.id}
                  onClick={() => router.push(`/properties/${propertyId}/projects/${p.id}`)}
                  className="cursor-pointer hover:bg-muted/50"
                >
                  <TableCell className="truncate">
                    <ProjectLink project={p} propertyId={propertyId} />
                    {p.unitLabel && (
                      <span className="ml-2 text-xs text-muted-foreground">{p.unitLabel}</span>
                    )}
                  </TableCell>
                  <TableCell className="truncate text-muted-foreground">
                    <span className="font-mono text-xs">{p.lineItem}</span>
                  </TableCell>
                  <TableCell>
                    <StageDot stage={p.stage} />
                  </TableCell>
                  <TableCell>
                    <AmountCell value={p.budget} />
                  </TableCell>
                  <TableCell>
                    <AmountCell value={p.committed} />
                  </TableCell>
                  <TableCell>
                    <AmountCell value={p.jtd} positive />
                  </TableCell>
                </TableRow>
              ))}
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
  propertyId,
  pending,
  onDropToStage,
}: {
  groups: Group[];
  groupBy: GroupBy;
  propertyId: number;
  pending: boolean;
  onDropToStage: (projectId: number, toStage: string) => void;
}) {
  const draggable = groupBy === "stage";
  const [dragOver, setDragOver] = useState<string | null>(null);

  return (
    <div>
      {!draggable && (
        <p className="mb-2 text-xs text-muted-foreground">
          Drag-to-move is available when grouped by Stage.
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
              if (pid) onDropToStage(pid, g.key);
            }}
            className={cn(
              "flex w-64 shrink-0 flex-col rounded-lg border bg-paper/60",
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
                  <ProjectLink project={p} propertyId={propertyId} className="text-sm" />
                  <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                    {p.lineItem}
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-xs font-semibold tabular-nums text-navy">
                      {money(p.budget)}
                    </span>
                    {groupBy !== "stage" && <StageBadge stage={p.stage} />}
                  </div>
                  {p.unitLabel && (
                    <div className="mt-1 text-[11px] text-muted-foreground">{p.unitLabel}</div>
                  )}
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

function GanttView({ groups, propertyId }: { groups: Group[]; propertyId: number }) {
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
                <ProjectLink project={p} propertyId={propertyId} className="truncate text-sm" />
                <div className="relative h-6 rounded bg-paper">
                  {d ? (
                    <div
                      className="absolute top-0 flex h-6 items-center rounded bg-navy px-2 text-[11px] font-medium text-white"
                      style={{
                        left: `${pct(d.start)}%`,
                        width: `${Math.max(2, pct(d.end) - pct(d.start))}%`,
                      }}
                      title={`${p.startDate} → ${p.completeDate ?? "in progress"}`}
                    >
                      <span className="truncate">{stageLabel(p.stage)}</span>
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

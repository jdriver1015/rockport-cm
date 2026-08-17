"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { EllipsisIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { createMilestone, updateMilestone, archiveMilestone } from "@/lib/actions/milestones";

export type MilestoneRow = {
  id: number;
  label: string;
  plannedDate: string | null;
  actualDate: string | null;
};

function daysBetween(planned: string | null, actual: string | null): number | null {
  if (!planned || !actual) return null;
  const p = new Date(planned + "T00:00:00");
  const a = new Date(actual + "T00:00:00");
  if (Number.isNaN(p.getTime()) || Number.isNaN(a.getTime())) return null;
  return Math.round((a.getTime() - p.getTime()) / 86_400_000);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function ProjectMilestonesTable({
  projectId,
  milestones,
}: {
  projectId: number;
  milestones: MilestoneRow[];
}) {
  const [drafts, setDrafts] = useState<{ key: string; createdId: number | null }[]>([]);
  const visibleDrafts = drafts.filter(
    (d) => d.createdId == null || !milestones.some((m) => m.id === d.createdId),
  );

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Milestone</TableHead>
            <TableHead className="text-right">Planned</TableHead>
            <TableHead className="text-right">Actual</TableHead>
            <TableHead className="text-right">Variance</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {milestones.length === 0 && visibleDrafts.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                No milestones yet.
              </TableCell>
            </TableRow>
          ) : (
            <>
              {milestones.map((m) => (
                <MilestoneRowItem key={m.id} milestone={m} projectId={projectId} />
              ))}
              {visibleDrafts.map((d) => (
                <MilestoneRowItem
                  key={d.key}
                  milestone={null}
                  projectId={projectId}
                  onDraftCreated={(id) =>
                    setDrafts((ds) => ds.map((x) => (x.key === d.key ? { ...x, createdId: id } : x)))
                  }
                  onDraftRemoved={() => setDrafts((ds) => ds.filter((x) => x.key !== d.key))}
                />
              ))}
            </>
          )}
          <TableRow className="hover:bg-transparent">
            <TableCell colSpan={5} className="py-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setDrafts((ds) => [...ds, { key: crypto.randomUUID(), createdId: null }])}
              >
                Add milestone
              </Button>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}

function MilestoneRowItem({
  milestone,
  projectId,
  onDraftCreated,
  onDraftRemoved,
}: {
  milestone: MilestoneRow | null;
  projectId: number;
  onDraftCreated?: (id: number) => void;
  onDraftRemoved?: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [id, setId] = useState<number | null>(milestone?.id ?? null);
  const [label, setLabel] = useState(milestone?.label ?? "");
  const [plannedDate, setPlannedDate] = useState(milestone?.plannedDate ?? "");
  const [actualDate, setActualDate] = useState(milestone?.actualDate ?? "");

  type FieldPatch = Partial<{ label: string; plannedDate: string; actualDate: string }>;

  function commit(patch: FieldPatch) {
    const next = {
      label: patch.label ?? label,
      plannedDate: patch.plannedDate ?? plannedDate,
      actualDate: patch.actualDate ?? actualDate,
    };
    startTransition(async () => {
      if (id == null) {
        if (!next.label.trim()) return; // nothing to create until there's a label
        const res = await createMilestone({
          projectId,
          label: next.label,
          plannedDate: next.plannedDate || null,
          actualDate: next.actualDate || null,
        });
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        setId(res.id);
        onDraftCreated?.(res.id);
        router.refresh();
        return;
      }
      const res = await updateMilestone({ id, ...patch });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      router.refresh();
    });
  }

  function handleDelete() {
    if (id == null) {
      onDraftRemoved?.();
      return;
    }
    startTransition(async () => {
      const res = await archiveMilestone({ id });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      router.refresh();
    });
  }

  function handleMarkComplete() {
    const t = todayIso();
    setActualDate(t);
    commit({ actualDate: t });
  }

  const variance = daysBetween(plannedDate || null, actualDate || null);

  return (
    <TableRow className={pending ? "opacity-60" : undefined}>
      <TableCell>
        <Input
          className="h-8 text-xs"
          value={label}
          placeholder="Milestone name"
          onChange={(e) => setLabel(e.target.value)}
          onBlur={() => commit({ label })}
        />
      </TableCell>
      <TableCell className="text-right">
        <Input
          className="h-8 w-36 text-right text-xs"
          type="date"
          value={plannedDate}
          onChange={(e) => setPlannedDate(e.target.value)}
          onBlur={() => commit({ plannedDate })}
        />
      </TableCell>
      <TableCell className="text-right">
        <Input
          className="h-8 w-36 text-right text-xs"
          type="date"
          value={actualDate}
          onChange={(e) => setActualDate(e.target.value)}
          onBlur={() => commit({ actualDate })}
        />
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {variance == null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span
            className={cn(
              "inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
              variance === 0
                ? "bg-positive/10 text-positive"
                : variance > 0
                  ? "bg-alert/10 text-alert"
                  : "bg-positive/10 text-positive",
            )}
          >
            {variance === 0 ? "on plan" : variance > 0 ? `+${variance}d late` : `${variance}d early`}
          </span>
        )}
      </TableCell>
      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-end gap-1">
          {!actualDate && id != null && (
            <Button size="sm" variant="ghost" disabled={pending} onClick={handleMarkComplete}>
              Mark complete
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger disabled={pending} render={<Button variant="ghost" size="icon-sm" />}>
              <EllipsisIcon />
              <span className="sr-only">Actions</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem variant="destructive" disabled={pending} onClick={handleDelete}>
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </TableCell>
    </TableRow>
  );
}

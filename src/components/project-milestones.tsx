"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PROJECT_PHASES } from "@/lib/stages";
import { createMilestone, updateMilestone, archiveMilestone } from "@/lib/actions/milestones";

export type MilestoneRow = {
  id: number;
  label: string;
  phase: string | null;
  plannedDate: string | null;
  actualDate: string | null;
  sortOrder: number;
};

function varianceDays(planned: string | null, actual: string | null): number | null {
  if (!planned || !actual) return null;
  const p = new Date(planned + "T00:00:00");
  const a = new Date(actual + "T00:00:00");
  return Math.round((a.getTime() - p.getTime()) / (1000 * 60 * 60 * 24));
}

function VarianceChip({ days }: { days: number | null }) {
  if (days === null) return null;
  if (days === 0)
    return <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-positive bg-positive/10">on time</span>;
  if (days > 0)
    return <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-alert bg-alert/10">+{days}d late</span>;
  return <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-positive bg-positive/10">{days}d early</span>;
}

function fmtShort(date: string | null) {
  if (!date) return "—";
  const d = new Date(date + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function ProjectMilestones({
  milestones,
  projectId,
}: {
  milestones: MilestoneRow[];
  projectId: number;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-navy">Milestones</h3>
        <AddMilestoneDialog projectId={projectId} nextSort={milestones.length} />
      </div>
      {milestones.length === 0 ? (
        <p className="text-sm text-muted-foreground">No milestones yet.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {milestones.map((ms) => {
            const days = varianceDays(ms.plannedDate, ms.actualDate);
            return (
              <MilestoneNode key={ms.id} ms={ms} days={days} />
            );
          })}
        </div>
      )}
    </div>
  );
}

function MilestoneNode({
  ms,
  days,
}: {
  ms: MilestoneRow;
  days: number | null;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const [pending, start] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("milestoneId", String(ms.id));
    start(async () => {
      const result = await updateMilestone(fd);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  function handleArchive() {
    const fd = new FormData();
    fd.set("milestoneId", String(ms.id));
    start(async () => {
      const result = await archiveMilestone(fd);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <button
            type="button"
            className="group flex flex-col items-start rounded-md border border-border bg-card px-3 py-2 text-left text-xs hover:border-navy/40 transition-colors"
          />
        }
      >
        <span className="font-medium text-navy">{ms.label}</span>
        <span className="text-muted-foreground mt-0.5">
          {ms.plannedDate ? `Plan ${fmtShort(ms.plannedDate)}` : "No plan date"}
          {ms.actualDate ? ` · Actual ${fmtShort(ms.actualDate)}` : ""}
        </span>
        <VarianceChip days={days} />
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit milestone</DialogTitle>
          <DialogDescription>Update dates and details for &ldquo;{ms.label}&rdquo;.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ms-label">Label</Label>
            <Input id="ms-label" name="label" defaultValue={ms.label} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ms-phase">Auto-stamp on phase</Label>
            <select
              id="ms-phase"
              name="phase"
              defaultValue={ms.phase ?? ""}
              className="block w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            >
              <option value="">Manual only</option>
              {PROJECT_PHASES.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="ms-planned">Planned date</Label>
              <Input id="ms-planned" name="plannedDate" type="date" defaultValue={ms.plannedDate ?? ""} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ms-actual">Actual date</Label>
              <Input id="ms-actual" name="actualDate" type="date" defaultValue={ms.actualDate ?? ""} />
            </div>
          </div>
          <div className="flex items-center justify-between pt-2">
            <Button type="button" variant="ghost" size="sm" className="text-alert" onClick={handleArchive} disabled={pending}>
              <Trash2Icon className="mr-1 h-3.5 w-3.5" />
              Remove
            </Button>
            <Button type="submit" disabled={pending}>Save</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AddMilestoneDialog({
  projectId,
  nextSort,
}: {
  projectId: number;
  nextSort: number;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const [pending, start] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("projectId", String(projectId));
    fd.set("sortOrder", String(nextSort));
    start(async () => {
      const result = await createMilestone(fd);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="sm" />}>
        <PlusIcon className="mr-1 h-3.5 w-3.5" />
        Add
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add milestone</DialogTitle>
          <DialogDescription>Track a dated checkpoint on this project&rsquo;s timeline.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="new-ms-label">Label</Label>
            <Input id="new-ms-label" name="label" placeholder="e.g. Kickoff, Inspection, Turnover" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-ms-phase">Auto-stamp on phase</Label>
            <select
              id="new-ms-phase"
              name="phase"
              defaultValue=""
              className="block w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            >
              <option value="">Manual only</option>
              {PROJECT_PHASES.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="new-ms-planned">Planned date</Label>
              <Input id="new-ms-planned" name="plannedDate" type="date" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-ms-actual">Actual date</Label>
              <Input id="new-ms-actual" name="actualDate" type="date" />
            </div>
          </div>
          <div className="flex justify-end pt-2">
            <Button type="submit" disabled={pending}>Add milestone</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

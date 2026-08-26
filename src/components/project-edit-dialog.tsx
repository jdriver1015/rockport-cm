"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useDialogOpen, type ControllableDialog } from "@/lib/use-dialog-open";
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
import { updateProject } from "@/lib/actions/projects";

export type ProjectCostCodeOption = { id: number; code: string; name: string };

export type ProjectEditData = {
  id: number;
  name: string;
  kind: "unit" | "common";
  /** Common-area only: the UW line item this reconciles to. */
  costCodeId: number | null;
  /** Common-area only. Zero means no budget approved yet. */
  budgetAmount: string | null;
  startDate: string | null;
  completeDate: string | null;
  notes: string | null;
  previousRent: string | null;
  tradeOutRent: string | null;
  leaseDate: string | null;
};

export function ProjectEditDialog({
  project,
  costCodes,
  ...dialog
}: {
  project: ProjectEditData;
  /** Non-interior codes from this property's chart. Empty for a unit turn. */
  costCodes: ProjectCostCodeOption[];
} & ControllableDialog) {
  const router = useRouter();
  const { open, setOpen, hasTrigger } = useDialogOpen(dialog);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      const fd = new FormData(e.currentTarget);
      const res = await updateProject(fd);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Project updated");
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {hasTrigger && (
        <DialogTrigger render={<Button size="sm" variant="outline" />}>Edit</DialogTrigger>
      )}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit project</DialogTitle>
          <DialogDescription>
            {project.kind === "common"
              ? "The cost code and budget live here — a project is created with just a name."
              : "Update the project’s details and dates."}
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <input type="hidden" name="projectId" value={project.id} />

          {/*
            An interior turn spends across every 4000-series code and gets its
            budget from a renovation template, so neither field applies to it.
          */}
          {project.kind === "common" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="project-cost-code">UW line item (cost code)</Label>
                <select
                  id="project-cost-code"
                  name="costCodeId"
                  defaultValue={project.costCodeId == null ? "" : String(project.costCodeId)}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <option value="">Not coded yet</option>
                  {costCodes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="project-name">Name</Label>
            <Input id="project-name" name="name" required defaultValue={project.name} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="project-start">Start date</Label>
              <Input
                id="project-start"
                name="startDate"
                type="date"
                defaultValue={project.startDate ?? ""}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="project-complete">Complete date</Label>
              <Input
                id="project-complete"
                name="completeDate"
                type="date"
                defaultValue={project.completeDate ?? ""}
              />
            </div>
          </div>

          {project.kind === "unit" && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="project-prev-rent">Previous rent ($)</Label>
                <Input
                  id="project-prev-rent"
                  name="previousRent"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={project.previousRent ?? ""}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="project-trade-rent">Trade-out rent ($)</Label>
                <Input
                  id="project-trade-rent"
                  name="tradeOutRent"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={project.tradeOutRent ?? ""}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="project-lease">Lease date</Label>
                <Input
                  id="project-lease"
                  name="leaseDate"
                  type="date"
                  defaultValue={project.leaseDate ?? ""}
                />
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="project-notes">Notes</Label>
            <Input id="project-notes" name="notes" defaultValue={project.notes ?? ""} />
          </div>

          <div className="flex justify-end">
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
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
import { updateProject } from "@/lib/actions/projects";

export type ProjectEditData = {
  id: number;
  name: string;
  kind: "unit" | "common";
  startDate: string | null;
  completeDate: string | null;
  notes: string | null;
  previousRent: string | null;
  tradeOutRent: string | null;
  leaseDate: string | null;
};

export function ProjectEditDialog({ project }: { project: ProjectEditData }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
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
      <DialogTrigger render={<Button size="sm" variant="outline" />}>Edit</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit project</DialogTitle>
          <DialogDescription>Update the project’s details and dates.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <input type="hidden" name="projectId" value={project.id} />
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

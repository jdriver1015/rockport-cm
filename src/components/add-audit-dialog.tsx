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
import { Textarea } from "@/components/ui/textarea";
import { QUARTER_HOUR_STEP } from "@/lib/walk-time";
import { createAudit } from "@/lib/actions/audits";

export function AddAuditDialog({
  propertyId,
  propertySlug,
  defaultAuditor,
  projects = [],
  defaultProjectId,
  ...dialog
}: {
  propertyId: number;
  propertySlug: string;
  defaultAuditor?: string | null;
  projects?: { id: number; name: string }[];
  defaultProjectId?: number;
} & ControllableDialog) {
  const router = useRouter();
  const { open, setOpen, hasTrigger } = useDialogOpen(dialog);
  const [busy, setBusy] = useState(false);
  const today = new Date().toLocaleDateString("en-CA");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await createAudit(new FormData(e.currentTarget));
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Audit created");
      setOpen(false);
      router.push(`/properties/${propertySlug}/audits/${result.auditId}`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create audit");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {hasTrigger && <DialogTrigger render={<Button size="sm" />}>New walk</DialogTrigger>}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New site walk</DialogTitle>
          <DialogDescription>
            Start a walk-through. Add findings and photos once it&apos;s created.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <input type="hidden" name="propertyId" value={propertyId} />
          {projects.length > 0 && (
            <div className="space-y-1.5">
              <Label htmlFor="audit-project">Project</Label>
              <select
                id="audit-project"
                name="projectId"
                defaultValue={defaultProjectId ?? ""}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <option value="">No project (property-wide)</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="audit-title">Title</Label>
            <Input
              id="audit-title"
              name="title"
              required
              placeholder="May site walk — exterior"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="audit-date">Date</Label>
              <Input id="audit-date" name="auditDate" type="date" required defaultValue={today} />
            </div>
            <div>
              <Label htmlFor="walk-time">Start time</Label>
              {/* step snaps the picker to quarter hours; roundToQuarterHour in
                  the action is what enforces it for a typed value. */}
              <Input
                id="walk-time"
                name="walkTime"
                type="time"
                step={QUARTER_HOUR_STEP}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="audit-auditor">Auditor</Label>
              <Input
                id="audit-auditor"
                name="auditorName"
                defaultValue={defaultAuditor ?? ""}
                placeholder="Name"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="audit-notes">Notes</Label>
            <Textarea
              id="audit-notes"
              name="notes"
              rows={3}
              placeholder="What this walk covers. You can write the summary as you go."
            />
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={busy}>
              {busy ? "Creating…" : "Create audit"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

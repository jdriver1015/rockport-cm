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
import { createAudit } from "@/lib/actions/audits";

export function AddAuditDialog({
  propertyId,
  defaultAuditor,
}: {
  propertyId: number;
  defaultAuditor?: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
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
      router.push(`/properties/${propertyId}/audits/${result.auditId}`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create audit");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>New audit</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New site audit</DialogTitle>
          <DialogDescription>
            Start a walk-through. Add findings and photos once it&apos;s created.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <input type="hidden" name="propertyId" value={propertyId} />
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
            <Input id="audit-notes" name="notes" placeholder="Optional context" />
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

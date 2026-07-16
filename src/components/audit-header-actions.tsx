"use client";

import { useState, useTransition } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { deleteAudit, restoreAudit, setAuditStatus, updateAudit } from "@/lib/actions/audits";

export type AuditHeader = {
  id: number;
  title: string;
  auditDate: string;
  auditorName: string | null;
  notes: string | null;
  status: "draft" | "complete";
};

export function AuditHeaderActions({
  propertyId,
  audit,
}: {
  propertyId: number;
  audit: AuditHeader;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex items-center gap-2">
      <a href={`/api/properties/${propertyId}/audits/${audit.id}/report`} target="_blank" rel="noreferrer">
        <Button size="sm" variant="outline">
          Export PDF
        </Button>
      </a>
      <Button
        size="sm"
        variant={audit.status === "complete" ? "outline" : "default"}
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const next = audit.status === "complete" ? "draft" : "complete";
            const res = await setAuditStatus({ id: audit.id, propertyId, status: next });
            if (!res.ok) {
              toast.error(res.error);
              return;
            }
            toast.success(next === "complete" ? "Audit marked complete" : "Reopened");
            router.refresh();
          })
        }
      >
        {audit.status === "complete" ? "Reopen" : "Mark complete"}
      </Button>
      <EditAuditDialog propertyId={propertyId} audit={audit} />
      <Button
        size="sm"
        variant="ghost"
        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
        disabled={pending}
        onClick={() => {
          startTransition(async () => {
            const res = await deleteAudit({ id: audit.id, propertyId });
            if (!res.ok) {
              toast.error(res.error);
              return;
            }
            toast.success("Audit deleted", {
              action: {
                label: "Undo",
                onClick: () =>
                  startTransition(async () => {
                    const undo = await restoreAudit({ id: audit.id, propertyId });
                    if (!undo.ok) toast.error(undo.error);
                    router.refresh();
                  }),
              },
            });
            router.push(`/properties/${propertyId}/audits`);
            router.refresh();
          });
        }}
      >
        Delete
      </Button>
    </div>
  );
}

function EditAuditDialog({ propertyId, audit }: { propertyId: number; audit: AuditHeader }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="ghost" />}>Edit</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit audit</DialogTitle>
          <DialogDescription>Title, date, auditor, and notes.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              const fd = new FormData(e.currentTarget);
              const res = await updateAudit({
                id: audit.id,
                propertyId,
                title: String(fd.get("title") ?? ""),
                auditDate: String(fd.get("auditDate") ?? ""),
                auditorName: String(fd.get("auditorName") ?? ""),
                notes: String(fd.get("notes") ?? ""),
              });
              if (!res.ok) {
                toast.error(res.error);
                return;
              }
              toast.success("Audit updated");
              setOpen(false);
              router.refresh();
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="ea-title">Title</Label>
            <Input id="ea-title" name="title" required defaultValue={audit.title} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ea-date">Date</Label>
              <Input id="ea-date" name="auditDate" type="date" required defaultValue={audit.auditDate} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ea-auditor">Auditor</Label>
              <Input id="ea-auditor" name="auditorName" defaultValue={audit.auditorName ?? ""} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ea-notes">Notes</Label>
            <Textarea id="ea-notes" name="notes" rows={3} defaultValue={audit.notes ?? ""} />
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

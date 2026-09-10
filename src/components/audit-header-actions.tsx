"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDownIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { QUARTER_HOUR_STEP } from "@/lib/walk-time";
import { deleteAudit, restoreAudit, setAuditStatus, updateAudit } from "@/lib/actions/audits";

export type AuditHeader = {
  id: number;
  title: string;
  auditDate: string;
  walkTime: string | null;
  auditorName: string | null;
  notes: string | null;
  status: "draft" | "complete";
};

/**
 * One visible action, everything else behind Manage.
 *
 * These were four peer buttons in a row — Export PDF, Mark complete, Edit,
 * Delete — all the same weight, which put the destructive one a thumb's width
 * from Edit on a phone and spent the whole strip above the walk on chrome.
 * Collapsing follows ProjectManageMenu, which already does exactly this for a
 * project. Finishing the walk is the only thing done from here often enough to
 * deserve a button of its own.
 */
export function AuditHeaderActions({
  propertyId,
  propertySlug,
  audit,
}: {
  propertyId: number;
  propertySlug: string;
  audit: AuditHeader;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editOpen, setEditOpen] = useState(false);
  const complete = audit.status === "complete";

  return (
    <div className="flex items-center gap-1.5">
      <Button
        size="sm"
        variant={complete ? "outline" : "default"}
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const next = complete ? "draft" : "complete";
            const res = await setAuditStatus({ id: audit.id, propertyId, status: next });
            if (!res.ok) {
              toast.error(res.error);
              return;
            }
            toast.success(next === "complete" ? "Walk complete" : "Walk reopened");
            // Completing a walk ends it, so leave. Refreshing in place left the
            // superintendent sitting on a finished walk with no exit but the
            // browser's back button. Reopening stays put — the point of
            // reopening is to carry on working here.
            if (next === "complete") {
              router.push(`/properties/${propertySlug}/audits`);
            }
            router.refresh();
          })
        }
      >
        {complete ? "Reopen" : "Mark complete"}
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger render={<Button size="sm" variant="ghost" />}>
          Manage
          <ChevronDownIcon className="size-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem
            render={
              <a
                href={`/api/properties/${propertyId}/audits/${audit.id}/report`}
                target="_blank"
                rel="noreferrer"
              />
            }
          >
            Export PDF
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setEditOpen(true)}>Edit details</DropdownMenuItem>

          <DropdownMenuSeparator />

          {/* Destructive styling stays, but it now lives behind a press
              instead of sitting next to Edit at the same size. */}
          <DropdownMenuItem
            variant="destructive"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const res = await deleteAudit({ id: audit.id, propertyId });
                if (!res.ok) {
                  toast.error(res.error);
                  return;
                }
                toast.success("Walk deleted", {
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
                router.push(`/properties/${propertySlug}/audits`);
                router.refresh();
              })
            }
          >
            Delete walk
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <EditAuditDialog
        propertyId={propertyId}
        audit={audit}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
    </div>
  );
}

/** Opened from the Manage menu, so it renders no trigger of its own. */
function EditAuditDialog({
  propertyId,
  audit,
  open,
  onOpenChange,
}: {
  propertyId: number;
  audit: AuditHeader;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit walk</DialogTitle>
          <DialogDescription>Title, when it happens, who walked it, and notes.</DialogDescription>
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
                walkTime: String(fd.get("walkTime") ?? ""),
                auditorName: String(fd.get("auditorName") ?? ""),
                notes: String(fd.get("notes") ?? ""),
              });
              if (!res.ok) {
                toast.error(res.error);
                return;
              }
              toast.success("Walk updated");
              onOpenChange(false);
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
              <Label htmlFor="ea-time">Start time</Label>
              {/* Quarter hours, same as scheduling: a walk booked for 9:07 is
                  nobody's intention. */}
              <Input
                id="ea-time"
                name="walkTime"
                type="time"
                step={QUARTER_HOUR_STEP}
                defaultValue={audit.walkTime?.slice(0, 5) ?? ""}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ea-auditor">Walked by</Label>
            <Input id="ea-auditor" name="auditorName" defaultValue={audit.auditorName ?? ""} />
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

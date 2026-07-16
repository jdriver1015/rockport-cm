"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
import {
  createFinding,
  deleteFinding,
  moveFinding,
  restoreFinding,
  updateFinding,
} from "@/lib/actions/audits";
import { AuditPhotoGallery, type PhotoRow } from "@/components/audit-photo-gallery";
import type { ActionResult } from "@/lib/action-result";
import { fmtDate } from "@/lib/format";

export type FindingRow = {
  id: number;
  title: string;
  description: string | null;
  location: string | null;
  severity: "low" | "medium" | "high";
  status: "open" | "resolved";
  assignee: string | null;
  dueDate: string | null;
};

const SEVERITY_VARIANT: Record<FindingRow["severity"], "secondary" | "pending" | "destructive"> = {
  low: "secondary",
  medium: "pending",
  high: "destructive",
};

export function AuditFindings({
  propertyId,
  auditId,
  findings,
  photosByFinding,
  readOnly,
}: {
  propertyId: number;
  auditId: number;
  findings: FindingRow[];
  photosByFinding: Record<number, PhotoRow[]>;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [newTitle, setNewTitle] = useState("");

  function addFinding(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const title = newTitle.trim();
    if (!title) return;
    startTransition(async () => {
      const res = await createFinding({ auditId, propertyId, title });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setNewTitle("");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {!readOnly && (
        <form onSubmit={addFinding} className="flex gap-2">
          <Input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Add a finding — e.g. Cracked sidewalk at building 3"
            className="flex-1"
          />
          <Button type="submit" disabled={pending || !newTitle.trim()}>
            Add finding
          </Button>
        </form>
      )}

      {findings.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No findings yet. Add the first one above.
        </p>
      ) : (
        <ol className="space-y-3">
          {findings.map((f, i) => (
            <li key={f.id} className="rounded-lg border p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-navy">
                      {i + 1}. {f.title}
                    </span>
                    <Badge variant={SEVERITY_VARIANT[f.severity]}>{f.severity}</Badge>
                    <Badge variant={f.status === "resolved" ? "positive" : "outline"}>
                      {f.status}
                    </Badge>
                  </div>
                  {f.description && (
                    <p className="mt-1 text-sm text-muted-foreground">{f.description}</p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {[
                      f.location && `Location: ${f.location}`,
                      f.assignee && `Assignee: ${f.assignee}`,
                      f.dueDate && `Due: ${fmtDate(f.dueDate)}`,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </p>
                </div>
                {!readOnly && (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      disabled={pending || i === 0}
                      onClick={() =>
                        startTransition(async () => {
                          await moveFinding({ id: f.id, propertyId, auditId, direction: "up" });
                          router.refresh();
                        })
                      }
                      aria-label="Move up"
                    >
                      <ChevronUpIcon className="size-4" />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      disabled={pending || i === findings.length - 1}
                      onClick={() =>
                        startTransition(async () => {
                          await moveFinding({ id: f.id, propertyId, auditId, direction: "down" });
                          router.refresh();
                        })
                      }
                      aria-label="Move down"
                    >
                      <ChevronDownIcon className="size-4" />
                    </Button>
                    <FindingEditDialog propertyId={propertyId} auditId={auditId} finding={f} />
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => {
                        startTransition(async () => {
                          const res = await deleteFinding({ id: f.id, propertyId, auditId });
                          if (!res.ok) {
                            toast.error(res.error);
                            return;
                          }
                          toast.success("Finding deleted", {
                            action: {
                              label: "Undo",
                              onClick: () =>
                                startTransition(async () => {
                                  const undo = await restoreFinding({ id: f.id, propertyId, auditId });
                                  if (!undo.ok) toast.error(undo.error);
                                  router.refresh();
                                }),
                            },
                          });
                          router.refresh();
                        });
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                )}
              </div>
              <AuditPhotoGallery
                propertyId={propertyId}
                auditId={auditId}
                findingId={f.id}
                photos={photosByFinding[f.id] ?? []}
                readOnly={readOnly}
              />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function FindingEditDialog({
  propertyId,
  auditId,
  finding,
}: {
  propertyId: number;
  auditId: number;
  finding: FindingRow;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<ActionResult>) {
    setBusy(true);
    try {
      const res = await fn();
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Finding updated");
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="ghost" />}>Edit</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit finding</DialogTitle>
          <DialogDescription>Details for this observation.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            void run(() =>
              updateFinding({
                id: finding.id,
                propertyId,
                auditId,
                title: String(fd.get("title") ?? ""),
                description: String(fd.get("description") ?? ""),
                location: String(fd.get("location") ?? ""),
                severity: fd.get("severity") as FindingRow["severity"],
                status: fd.get("status") as FindingRow["status"],
                assignee: String(fd.get("assignee") ?? ""),
                dueDate: String(fd.get("dueDate") ?? ""),
              }),
            );
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor={`f-title-${finding.id}`}>Title</Label>
            <Input id={`f-title-${finding.id}`} name="title" required defaultValue={finding.title} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`f-desc-${finding.id}`}>Description</Label>
            <Textarea
              id={`f-desc-${finding.id}`}
              name="description"
              defaultValue={finding.description ?? ""}
              rows={3}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor={`f-loc-${finding.id}`}>Location / area</Label>
              <Input
                id={`f-loc-${finding.id}`}
                name="location"
                defaultValue={finding.location ?? ""}
                placeholder="Building 3, unit 214…"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`f-assignee-${finding.id}`}>Assignee</Label>
              <Input
                id={`f-assignee-${finding.id}`}
                name="assignee"
                defaultValue={finding.assignee ?? ""}
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor={`f-sev-${finding.id}`}>Severity</Label>
              <select
                id={`f-sev-${finding.id}`}
                name="severity"
                defaultValue={finding.severity}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`f-status-${finding.id}`}>Status</Label>
              <select
                id={`f-status-${finding.id}`}
                name="status"
                defaultValue={finding.status}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <option value="open">Open</option>
                <option value="resolved">Resolved</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`f-due-${finding.id}`}>Due date</Label>
              <Input
                id={`f-due-${finding.id}`}
                name="dueDate"
                type="date"
                defaultValue={finding.dueDate ?? ""}
              />
            </div>
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

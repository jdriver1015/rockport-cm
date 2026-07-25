"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2Icon, AlertTriangleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { setProjectPhase } from "@/lib/actions/projects";
import type { GateResult } from "@/lib/phase-gates";

export function AdvancePhaseDialog({
  projectId,
  gateResult,
  toLabel,
}: {
  projectId: number;
  gateResult: GateResult;
  toLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const router = useRouter();
  const [pending, start] = useTransition();

  const { checks, allMet, metCount } = gateResult;
  const unmetCount = checks.length - metCount;

  function handleAdvance() {
    const fd = new FormData();
    fd.set("projectId", String(projectId));
    fd.set("toPhase", gateResult.toPhase);

    if (!allMet) {
      const unmetLabels = checks.filter((c) => !c.met).map((c) => c.label).join("; ");
      const overrideNote = `Advanced with ${unmetCount} unmet gate${unmetCount === 1 ? "" : "s"}: ${unmetLabels}${note ? ` — ${note}` : ""}`;
      fd.set("note", overrideNote);
    } else if (note) {
      fd.set("note", note);
    }

    start(async () => {
      const result = await setProjectPhase(fd);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setOpen(false);
      setNote("");
      router.refresh();
    });
  }

  if (checks.length === 0) {
    return (
      <Button
        disabled={pending}
        onClick={() => {
          const fd = new FormData();
          fd.set("projectId", String(projectId));
          fd.set("toPhase", gateResult.toPhase);
          start(async () => {
            const result = await setProjectPhase(fd);
            if (!result.ok) {
              toast.error(result.error);
              return;
            }
            router.refresh();
          });
        }}
      >
        Advance to {toLabel}
      </Button>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>Advance to {toLabel}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Advance to {toLabel}</DialogTitle>
          <DialogDescription>
            Review the gate checks below before advancing this project.
          </DialogDescription>
        </DialogHeader>

        {!allMet && (
          <div className="rounded-md border border-pending/30 bg-pending/5 px-3 py-2 text-sm text-pending">
            <AlertTriangleIcon className="mr-1.5 inline-block h-4 w-4 align-text-bottom" />
            {unmetCount} of {checks.length} check{checks.length === 1 ? "" : "s"} not met
          </div>
        )}

        <ul className="space-y-2">
          {checks.map((c) => (
            <li key={c.label} className="flex items-start gap-2 text-sm">
              {c.met ? (
                <CheckCircle2Icon className="mt-0.5 h-4 w-4 shrink-0 text-positive" />
              ) : (
                <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-pending" />
              )}
              <div>
                <span className="font-medium">{c.label}</span>
                <span className="ml-1.5 text-muted-foreground">{c.detail}</span>
              </div>
            </li>
          ))}
        </ul>

        {!allMet && (
          <div className="space-y-2">
            <Label htmlFor="override-note">Override note</Label>
            <textarea
              id="override-note"
              className="block w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              rows={2}
              placeholder="Why are you advancing with unmet gates?"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={handleAdvance} disabled={pending} variant={allMet ? "default" : "secondary"}>
            {allMet ? "Advance" : "Advance anyway"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

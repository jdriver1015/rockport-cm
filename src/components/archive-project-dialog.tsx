"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { archiveProject } from "@/lib/actions/projects";

export function ArchiveProjectDialog({
  propertyId,
  projectId,
  projectName,
}: {
  propertyId: number;
  projectId: number;
  projectName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleArchive() {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("projectId", String(projectId));
      const res = await archiveProject(fd);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Project archived");
      setOpen(false);
      router.push(`/properties/${propertyId}`);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            size="sm"
            variant="destructive"
          />
        }
      >
        Archive
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Archive this project?</DialogTitle>
          <DialogDescription>
            &ldquo;{projectName}&rdquo; will be hidden from the active project board. Its scope,
            bids, and GL history are kept, and it can be restored anytime from the Archived
            projects list.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={pending} />}>Cancel</DialogClose>
          <Button variant="destructive" disabled={pending} onClick={handleArchive}>
            {pending ? "Archiving…" : "Archive project"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

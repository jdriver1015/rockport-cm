"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useDialogOpen, type ControllableDialog } from "@/lib/use-dialog-open";
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
import { archiveProperty, restoreProperty } from "@/lib/actions/properties";

/**
 * Archiving is the only way to remove a property, so the copy has to say what
 * that does and does not mean — nothing is deleted, and it comes back.
 *
 * Deliberately no impact counts ("13 projects, $1.2M posted"). PropertyHeader
 * renders on every property page, and counting each one's subtree to fill a
 * dialog nobody opens would put a query on every page load for a rare action.
 */
export function ArchivePropertyDialog({
  propertyId,
  propertyName,
  ...dialog
}: {
  propertyId: number;
  propertyName: string;
} & ControllableDialog) {
  const router = useRouter();
  const { open, setOpen, hasTrigger } = useDialogOpen(dialog);
  const [pending, startTransition] = useTransition();

  function handleArchive() {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", String(propertyId));
      const res = await archiveProperty(fd);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Property archived");
      setOpen(false);
      // Back to the portfolio: staying here would leave the reader on a property
      // that no longer appears in any list.
      router.push("/");
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {hasTrigger && (
        // Ghost, not destructive: this sits on every property page, and a
        // permanently red button beside Edit reads as a warning about the
        // property rather than an action you can take. The confirm carries the
        // weight instead.
        <DialogTrigger render={<Button size="sm" variant="ghost" />}>Archive</DialogTrigger>
      )}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Archive this property?</DialogTitle>
          <DialogDescription>
            &ldquo;{propertyName}&rdquo; will be hidden from the portfolio, the schedule and every
            rollup. Nothing is deleted — its projects, budgets, GL history, rent rolls and audits
            are all kept, and it can be restored anytime from the Archived properties list.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={pending} />}>Cancel</DialogClose>
          <Button variant="destructive" disabled={pending} onClick={handleArchive}>
            {pending ? "Archiving…" : "Archive property"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The counterpart, for an archived property's own pages.
 *
 * No confirm step: restoring destroys nothing and is itself undone by archiving
 * again. A dialog here would be ceremony for a reversible act.
 */
export function RestorePropertyButton({
  propertyId,
}: {
  propertyId: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      size="sm"
      disabled={pending}
      onClick={() => {
        const fd = new FormData();
        fd.set("id", String(propertyId));
        startTransition(async () => {
          const res = await restoreProperty(fd);
          if (!res.ok) {
            toast.error(res.error);
            return;
          }
          toast.success("Property restored");
          router.refresh();
        });
      }}
    >
      {pending ? "Restoring…" : "Restore property"}
    </Button>
  );
}

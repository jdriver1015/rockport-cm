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
import { createProfile, deleteProfile, restoreProfile, updateProfile } from "@/lib/actions/settings";
import { fmtDate } from "@/lib/format";

const ROLES = [
  { value: "admin", label: "Admin" },
  { value: "cm", label: "Construction Manager" },
  { value: "site", label: "Site staff" },
  { value: "viewer", label: "Viewer" },
] as const;

export function AddUserDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>Add user</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add user</DialogTitle>
          <DialogDescription>
            Adds a person to the roster and sets their role. They can sign in once authentication is
            enabled.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              const result = await createProfile(new FormData(e.currentTarget));
              if (!result.ok) {
                toast.error(result.error);
                return;
              }
              toast.success("User added");
              setOpen(false);
              router.refresh();
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Could not add user");
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="u-email">Email</Label>
            <Input id="u-email" name="email" type="email" required placeholder="name@westcreek-capital.com" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="u-name">Full name</Label>
            <Input id="u-name" name="fullName" placeholder="Jane Driver" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="u-role">Role</Label>
            <select
              id="u-role"
              name="role"
              defaultValue="viewer"
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={busy}>
              {busy ? "Adding…" : "Add user"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function UserDetailDialog({
  id,
  fullName,
  email,
  role,
  createdAt,
}: {
  id: string;
  fullName: string | null;
  email: string;
  role: "admin" | "cm" | "site" | "viewer";
  createdAt: string | Date;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await updateProfile(new FormData(e.currentTarget));
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("User updated");
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function handleRemove() {
    setBusy(true);
    (async () => {
      try {
        const result = await deleteProfile(id);
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        toast.success("User removed", {
          action: {
            label: "Undo",
            onClick: () => {
              void (async () => {
                const undo = await restoreProfile(id);
                if (!undo.ok) toast.error(undo.error);
                router.refresh();
              })();
            },
          },
        });
        setOpen(false);
        router.refresh();
      } finally {
        setBusy(false);
      }
    })();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="ghost" />}>Edit</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{fullName || email}</DialogTitle>
          <DialogDescription>Added {fmtDate(createdAt)}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSave}>
          <input type="hidden" name="id" value={id} />
          <div className="space-y-1.5">
            <Label htmlFor={`u-name-${id}`}>Full name</Label>
            <Input
              id={`u-name-${id}`}
              name="fullName"
              defaultValue={fullName ?? ""}
              placeholder="Jane Driver"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`u-email-${id}`}>Email</Label>
            <Input id={`u-email-${id}`} name="email" type="email" required defaultValue={email} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`u-role-${id}`}>Role</Label>
            <select
              id={`u-role-${id}`}
              name="role"
              defaultValue={role}
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center justify-between gap-2 border-t pt-3">
            <Button type="button" variant="destructive" size="sm" disabled={busy} onClick={handleRemove}>
              Remove
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RestoreUserButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          const result = await restoreProfile(id);
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          toast.success("User restored");
          router.refresh();
        });
      }}
    >
      {pending ? "Restoring…" : "Restore"}
    </Button>
  );
}

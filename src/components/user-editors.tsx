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
import {
  createProfile,
  deleteProfile,
  restoreProfile,
  updateProfileRole,
} from "@/lib/actions/settings";
import type { ActionResult } from "@/lib/action-result";

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

export function UserRowActions({
  id,
  role,
}: {
  id: string;
  role: "admin" | "cm" | "site" | "viewer";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<ActionResult>, ok?: string) =>
    startTransition(async () => {
      try {
        const result = await fn();
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        if (ok) toast.success(ok);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Something went wrong");
      }
    });

  return (
    <div className="flex items-center justify-end gap-2">
      <select
        disabled={pending}
        value={role}
        onChange={(e) =>
          run(
            () => updateProfileRole(id, e.target.value as typeof role),
            "Role updated",
          )
        }
        className="h-8 rounded-md border border-input bg-transparent px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
      >
        {ROLES.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </select>
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => {
          if (!window.confirm("Remove this user?")) return;
          startTransition(async () => {
            const result = await deleteProfile(id);
            if (!result.ok) {
              toast.error(result.error);
              return;
            }
            toast.success("User removed", {
              action: {
                label: "Undo",
                onClick: () => {
                  startTransition(async () => {
                    const undo = await restoreProfile(id);
                    if (!undo.ok) toast.error(undo.error);
                  });
                },
              },
            });
            router.refresh();
          });
        }}
      >
        Remove
      </Button>
    </div>
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

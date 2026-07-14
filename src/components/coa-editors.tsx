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
import { useTransition } from "react";
import {
  createCategory,
  createCostCode,
  setCategoryDivision,
  updateCostCode,
} from "@/lib/actions/settings";
import type { ActionResult } from "@/lib/action-result";
import { DIVISIONS } from "@/lib/divisions";

type Category = { id: number; code: string; name: string };

export function CategoryDivisionSelect({
  id,
  division,
}: {
  id: number;
  division: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <select
      disabled={pending}
      value={division ?? ""}
      onChange={(e) => {
        const value = e.target.value || null;
        startTransition(async () => {
          const result = await setCategoryDivision(id, value);
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          router.refresh();
        });
      }}
      className="h-7 rounded-md border border-input bg-transparent px-2 text-xs text-muted-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
    >
      <option value="">Unassigned</option>
      {DIVISIONS.map((d) => (
        <option key={d.key} value={d.key}>
          {d.label}
        </option>
      ))}
    </select>
  );
}

export function AddCategoryDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>Add category</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add category</DialogTitle>
          <DialogDescription>A 4-digit lender category, e.g. 1100 Roof.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              const result = await createCategory(new FormData(e.currentTarget));
              if (!result.ok) {
                toast.error(result.error);
                return;
              }
              toast.success("Category added");
              setOpen(false);
              router.refresh();
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Could not add category");
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="cat-code">Code</Label>
            <Input id="cat-code" name="code" required placeholder="1100" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cat-name">Name</Label>
            <Input id="cat-name" name="name" required placeholder="Roof" />
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={busy}>
              {busy ? "Adding…" : "Add category"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AddCostCodeDialog({ categories }: { categories: Category[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>Add cost code</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add cost code</DialogTitle>
          <DialogDescription>A tracked line under a category, e.g. 1100-0001 Roofing Repair.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              const result = await createCostCode(new FormData(e.currentTarget));
              if (!result.ok) {
                toast.error(result.error);
                return;
              }
              toast.success("Cost code added");
              setOpen(false);
              router.refresh();
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Could not add cost code");
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="cc-cat">Category</Label>
            <select
              id="cc-cat"
              name="categoryId"
              required
              defaultValue=""
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <option value="" disabled>
                Select a category…
              </option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="cc-code">Code</Label>
              <Input id="cc-code" name="code" required placeholder="1100-0001" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cc-name">Name</Label>
              <Input id="cc-name" name="name" required placeholder="Roofing Repair" />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="isInterior" className="size-4" />
            Interior — rolls up to unit turns (4000-series)
          </label>
          <div className="flex justify-end">
            <Button type="submit" disabled={busy}>
              {busy ? "Adding…" : "Add cost code"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function EditCostCodeDialog({
  id,
  code,
  name,
  active,
  isInterior,
}: {
  id: number;
  code: string;
  name: string;
  active: boolean;
  isInterior: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<ActionResult>, ok: string) => {
    setBusy(true);
    try {
      const result = await fn();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(ok);
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="ghost" />}>Edit</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            <span className="font-mono">{code}</span>
          </DialogTitle>
          <DialogDescription>Rename, change type, or activate/deactivate.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            void run(
              () =>
                updateCostCode({
                  id,
                  name: String(fd.get("name") ?? ""),
                  isInterior: fd.get("isInterior") === "on",
                }),
              "Cost code updated",
            );
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor={`edit-name-${id}`}>Name</Label>
            <Input id={`edit-name-${id}`} name="name" defaultValue={name} required />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="isInterior" defaultChecked={isInterior} className="size-4" />
            Interior (4000-series)
          </label>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => run(() => updateCostCode({ id, active: !active }), active ? "Deactivated" : "Activated")}
            >
              {active ? "Deactivate" : "Activate"}
            </Button>
            <Button type="submit" disabled={busy}>
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

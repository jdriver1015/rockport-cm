"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  archiveScopeTemplate,
  createScopeTemplate,
  duplicateScopeTemplate,
  updateScopeTemplate,
} from "@/lib/actions/scope-group-templates";

export function AddTemplateDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const result = await createScopeTemplate({
        name: String(fd.get("name") ?? ""),
        description: String(fd.get("description") ?? "") || undefined,
      });
      if (!result.ok) return toast.error(result.error);
      toast.success("Template created");
      setOpen(false);
      router.push(`/settings/scope-groups/${result.templateId}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>Add template</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add renovation template</DialogTitle>
          <DialogDescription>
            A standard package (e.g. Classic Refresh) offered as a base when creating property scope
            groups.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-1.5">
            <Label htmlFor="tpl-name">Name</Label>
            <Input id="tpl-name" name="name" required placeholder="Classic Refresh" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tpl-desc">Description</Label>
            <Textarea id="tpl-desc" name="description" rows={2} placeholder="Optional" />
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={busy}>
              {busy ? "Creating…" : "Create template"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function TemplateRowActions({
  id,
  name,
  description,
}: {
  id: number;
  name: string;
  description: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) {
    setBusy(true);
    try {
      const result = await fn();
      if (!result.ok) return toast.error(result.error ?? "Something went wrong");
      toast.success(ok);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleEdit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const result = await updateScopeTemplate({
        id,
        name: String(fd.get("name") ?? ""),
        description: String(fd.get("description") ?? "") || undefined,
      });
      if (!result.ok) return toast.error(result.error);
      toast.success("Template updated");
      setEditOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleDuplicate() {
    setBusy(true);
    try {
      const result = await duplicateScopeTemplate(id);
      if (!result.ok) return toast.error(result.error);
      toast.success("Template duplicated");
      router.push(`/settings/scope-groups/${result.templateId}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" disabled={busy} />}>
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setEditOpen(true)}>Rename / edit</DropdownMenuItem>
          <DropdownMenuItem onClick={handleDuplicate}>Duplicate</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => run(() => archiveScopeTemplate(id), "Template archived")}
          >
            Archive
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit template</DialogTitle>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleEdit}>
            <div className="space-y-1.5">
              <Label htmlFor={`edit-tpl-name-${id}`}>Name</Label>
              <Input id={`edit-tpl-name-${id}`} name="name" defaultValue={name} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`edit-tpl-desc-${id}`}>Description</Label>
              <Textarea
                id={`edit-tpl-desc-${id}`}
                name="description"
                rows={2}
                defaultValue={description ?? ""}
              />
            </div>
            <div className="flex justify-end">
              <Button type="submit" disabled={busy}>
                Save
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

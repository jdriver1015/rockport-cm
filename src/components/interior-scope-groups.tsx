"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  archiveGroup,
  createBlankGroup,
  createGroupFromTemplate,
  duplicateGroup,
  updateGroup,
} from "@/lib/actions/scope-groups";

type GroupRow = {
  id: number;
  name: string;
  description: string | null;
  sourceTemplateId: number | null;
  itemCount: number;
};
type TemplateOption = { id: number; name: string };

const selectClass =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50";

export function ManageScopeGroupsButton({
  propertyId,
  groups,
  templates,
}: {
  propertyId: number;
  groups: GroupRow[];
  templates: TemplateOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleFromTemplate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const templateId = Number(fd.get("templateId"));
    if (!templateId) return toast.error("Pick a template");
    setBusy(true);
    try {
      const result = await createGroupFromTemplate({
        propertyId,
        templateId,
        name: String(fd.get("name") ?? "") || undefined,
      });
      if (!result.ok) return toast.error(result.error);
      toast.success(
        result.unresolved > 0
          ? `Scope group created — ${result.unresolved} item(s) had no matching code in this chart`
          : "Scope group created",
      );
      router.push(`/properties/${propertyId}/interiors/scope-groups/${result.groupId}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleBlank(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const result = await createBlankGroup({
        propertyId,
        name: String(fd.get("name") ?? ""),
        description: String(fd.get("description") ?? "") || undefined,
      });
      if (!result.ok) return toast.error(result.error);
      toast.success("Scope group created");
      router.push(`/properties/${propertyId}/interiors/scope-groups/${result.groupId}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>Manage Scope Groups</DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Scope groups</DialogTitle>
          <DialogDescription>
            Renovation packages for this property. Create from a portfolio template or blank.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="template">
          <TabsList className="w-full">
            <TabsTrigger value="template" disabled={templates.length === 0}>
              From template
            </TabsTrigger>
            <TabsTrigger value="blank">Blank</TabsTrigger>
          </TabsList>

          <TabsContent value="template">
            <form className="flex items-end gap-2" onSubmit={handleFromTemplate}>
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="sg-template">Template</Label>
                <select id="sg-template" name="templateId" required defaultValue="" className={selectClass}>
                  <option value="" disabled>
                    Select…
                  </option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="sg-tpl-name">Name (optional)</Label>
                <Input id="sg-tpl-name" name="name" placeholder="Defaults to template name" />
              </div>
              <Button type="submit" disabled={busy}>
                Create
              </Button>
            </form>
          </TabsContent>

          <TabsContent value="blank">
            <form className="space-y-3" onSubmit={handleBlank}>
              <div className="space-y-1.5">
                <Label htmlFor="sg-blank-name">Name</Label>
                <Input id="sg-blank-name" name="name" required placeholder="Custom Package" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sg-blank-desc">Description</Label>
                <Textarea id="sg-blank-desc" name="description" rows={2} />
              </div>
              <div className="flex justify-end">
                <Button type="submit" disabled={busy}>
                  Create blank
                </Button>
              </div>
            </form>
          </TabsContent>
        </Tabs>

        <div className="mt-2 divide-y border-t">
          {groups.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">No scope groups yet.</p>
          )}
          {groups.map((g) => (
            <div key={g.id} className="flex items-center gap-2 py-2">
              <Link
                href={`/properties/${propertyId}/interiors/scope-groups/${g.id}`}
                className="min-w-0 flex-1 hover:underline"
              >
                <span className="font-medium text-navy">{g.name}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {g.itemCount} item{g.itemCount === 1 ? "" : "s"}
                </span>
              </Link>
              <GroupRowActions propertyId={propertyId} group={g} />
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function GroupRowActions({ propertyId, group }: { propertyId: number; group: GroupRow }) {
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
      const result = await updateGroup({
        id: group.id,
        propertyId,
        name: String(fd.get("name") ?? ""),
        description: String(fd.get("description") ?? "") || undefined,
      });
      if (!result.ok) return toast.error(result.error);
      toast.success("Scope group updated");
      setEditOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button render={<Link href={`/properties/${propertyId}/interiors/scope-groups/${group.id}`} />} variant="ghost" size="sm" nativeButton={false}>
        Edit items
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" disabled={busy} />}>
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setEditOpen(true)}>Rename / edit</DropdownMenuItem>
          <DropdownMenuItem onClick={() => run(() => duplicateGroup({ id: group.id, propertyId }), "Duplicated")}>
            Duplicate
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => run(() => archiveGroup({ id: group.id, propertyId }), "Archived")}
          >
            Archive
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit scope group</DialogTitle>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleEdit}>
            <div className="space-y-1.5">
              <Label htmlFor={`eg-name-${group.id}`}>Name</Label>
              <Input id={`eg-name-${group.id}`} name="name" defaultValue={group.name} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`eg-desc-${group.id}`}>Description</Label>
              <Textarea id={`eg-desc-${group.id}`} name="description" rows={2} defaultValue={group.description ?? ""} />
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

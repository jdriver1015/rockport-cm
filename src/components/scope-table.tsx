"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ExternalLinkIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createScopeItem, deleteScopeItem, updateScopeItem } from "@/lib/actions/scope";

export type ScopeRow = {
  id: number;
  item: string;
  materialQuality: string | null;
  productLink: string | null;
};

export function ScopeTable({
  propertyId,
  projectId,
  items,
}: {
  propertyId: number;
  projectId: number;
  items: ScopeRow[];
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base text-navy">Scope</CardTitle>
        <ScopeItemDialog propertyId={propertyId} projectId={projectId} />
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No scope items yet — add the first with “Add scope item”.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Materials / quality</TableHead>
                  <TableHead>Product link</TableHead>
                  <TableHead className="text-right">Edit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((r) => (
                  <ScopeItemRow
                    key={r.id}
                    row={r}
                    propertyId={propertyId}
                    projectId={projectId}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ScopeItemRow({
  row,
  propertyId,
  projectId,
}: {
  row: ScopeRow;
  propertyId: number;
  projectId: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok?: string) =>
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        toast.error(res.error ?? "Something went wrong");
        return;
      }
      if (ok) toast.success(ok);
      router.refresh();
    });

  return (
    <TableRow className={pending ? "opacity-60" : undefined}>
      <TableCell className="font-medium text-navy">{row.item}</TableCell>
      <TableCell className="max-w-xs text-muted-foreground">{row.materialQuality || "—"}</TableCell>
      <TableCell className="text-muted-foreground">
        {row.productLink ? (
          <a
            href={row.productLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-gold-link hover:underline"
          >
            View <ExternalLinkIcon className="size-3.5" />
          </a>
        ) : (
          "—"
        )}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-1">
          <ScopeItemDialog propertyId={propertyId} projectId={projectId} existing={row} />
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => {
              if (window.confirm(`Delete “${row.item}”?`)) {
                run(() => deleteScopeItem({ id: row.id, propertyId, projectId }), "Deleted");
              }
            }}
          >
            Delete
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

function ScopeItemDialog({
  propertyId,
  projectId,
  existing,
}: {
  propertyId: number;
  projectId: number;
  existing?: ScopeRow;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const editing = !!existing;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      const fd = new FormData(e.currentTarget);
      const res = editing
        ? await updateScopeItem({
            id: existing!.id,
            propertyId,
            projectId,
            item: String(fd.get("item") ?? ""),
            materialQuality: String(fd.get("materialQuality") ?? ""),
            productLink: String(fd.get("productLink") ?? ""),
          })
        : await createScopeItem(fd);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(editing ? "Scope item updated" : "Scope item added");
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save scope item");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant={editing ? "ghost" : "default"} />}>
        {editing ? "Edit" : "Add scope item"}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Edit scope item" : "Add scope item"}</DialogTitle>
          <DialogDescription>
            The work and materials for this line — vendors price it in their bids.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <input type="hidden" name="propertyId" value={propertyId} />
          <input type="hidden" name="projectId" value={projectId} />
          <div className="space-y-1.5">
            <Label htmlFor="scope-item">Item</Label>
            <Input
              id="scope-item"
              name="item"
              required
              defaultValue={existing?.item}
              placeholder="LVP flooring"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="scope-quality">Materials / quality</Label>
            <Input
              id="scope-quality"
              name="materialQuality"
              defaultValue={existing?.materialQuality ?? ""}
              placeholder="20 mil wear layer, waterproof core"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="scope-link">Product link</Label>
            <Input
              id="scope-link"
              name="productLink"
              type="url"
              defaultValue={existing?.productLink ?? ""}
              placeholder="https://…"
            />
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : editing ? "Save" : "Add scope item"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

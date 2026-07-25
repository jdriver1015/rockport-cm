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
  TableGroupRow,
  TableHead,
  TableHeader,
  TableRow,
  TableSpacerRow,
} from "@/components/ui/table";
import { ScopeStatusSelect } from "@/components/scope-status-select";
import { groupScopeByCategory } from "@/lib/scope-grouping";
import { SCOPE_SECTIONS } from "@/lib/scope-sections";
import {
  createScopeItem,
  deleteScopeItem,
  restoreScopeItem,
  updateScopeItem,
} from "@/lib/actions/scope";

export type ScopeRow = {
  id: number;
  item: string;
  materialQuality: string | null;
  productLink: string | null;
  category: string | null;
  status: string;
};

const COLS = 5;

export function ScopeTable({
  propertyId,
  projectId,
  items,
}: {
  propertyId: number;
  projectId: number;
  items: ScopeRow[];
}) {
  // Spec-only lines carry no pricing, so the rollup is a plain line count here.
  const groups = groupScopeByCategory(
    items.map((r) => ({ ...r, quantity: null, unitPrice: null, row: r })),
  );

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
                <TableRow className="hover:bg-transparent">
                  <TableHead>Item</TableHead>
                  <TableHead>Materials / quality</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Product link</TableHead>
                  <TableHead className="text-right">Edit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.flatMap((g, gi) => [
                  ...(gi > 0 ? [<TableSpacerRow key={`sp-${g.label}`} colSpan={COLS} />] : []),
                  <TableGroupRow
                    key={`g-${g.label}`}
                    label={g.label}
                    count={`${g.progress.complete} of ${g.progress.total} complete`}
                    colSpan={COLS}
                  />,
                  ...g.lines.map(({ row }) => (
                    <ScopeItemRow
                      key={row.id}
                      row={row}
                      propertyId={propertyId}
                      projectId={projectId}
                    />
                  )),
                ])}
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

  return (
    <TableRow className={pending ? "opacity-60" : undefined}>
      <TableCell className="font-medium text-navy">{row.item}</TableCell>
      <TableCell className="max-w-xs text-muted-foreground">{row.materialQuality || "—"}</TableCell>
      <TableCell>
        <ScopeStatusSelect
          id={row.id}
          propertyId={propertyId}
          projectId={projectId}
          status={row.status}
        />
      </TableCell>
      <TableCell className="text-muted-foreground">
        {row.productLink ? (
          <a
            href={row.productLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-link hover:underline"
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
              startTransition(async () => {
                const res = await deleteScopeItem({ id: row.id, propertyId, projectId });
                if (!res.ok) {
                  toast.error(res.error);
                  return;
                }
                toast.success("Scope item deleted", {
                  action: {
                    label: "Undo",
                    onClick: () => {
                      startTransition(async () => {
                        const undo = await restoreScopeItem({ id: row.id, propertyId, projectId });
                        if (!undo.ok) toast.error(undo.error);
                      });
                    },
                  },
                });
                router.refresh();
              });
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
            category: String(fd.get("category") ?? ""),
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
            <Label htmlFor="scope-category">Trade section</Label>
            <select
              id="scope-category"
              name="category"
              defaultValue={existing?.category ?? ""}
              className="h-9 w-full rounded-control border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <option value="">—</option>
              {SCOPE_SECTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
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

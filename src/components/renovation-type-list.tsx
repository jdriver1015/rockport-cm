"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { EllipsisIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableCard } from "@/components/ui/table-card";
import { ClickableTableRow } from "@/components/ui/clickable-table-row";
import { money } from "@/lib/format";
import {
  archiveGroup,
  createBlankGroup,
  createGroupFromTemplate,
  duplicateGroup,
  updateGroup,
} from "@/lib/actions/budget-groups";

export type RenovationTypeRow = {
  id: number;
  name: string;
  description: string | null;
  sourceTemplateName: string | null;
  lineCount: number;
  /** Σ planned units across floorplans, from the same compute the pivot uses. */
  plannedUnits: number;
  /** Σ planned cost. Blank when nothing is planned yet. */
  totalCost: number;
  /** Weighted average — floorplans differ in size, so there is no single figure. */
  avgPerUnit: number | null;
  targetTradeOut: number | null;
};

export type TemplateOption = { id: number; name: string };

export function RenovationTypeList({
  propertyId,
  propertySlug,
  types,
  templates,
}: {
  propertyId: number;
  propertySlug: string;
  types: RenovationTypeRow[];
  templates: TemplateOption[];
}) {
  const [addOpen, setAddOpen] = useState(false);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          What a turn <em>is</em> — the pricing, scope, and specs a floorplan inherits when it is
          planned into this type. How many units get each is set on the Budget tab.
        </p>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          Add renovation type
        </Button>
      </div>

      {types.length === 0 ? (
        <TableCard>
          <p className="py-10 text-center text-sm text-muted-foreground">
            No renovation types yet — add one from a portfolio default to get its pricing and scope.
          </p>
        </TableCard>
      ) : (
        <TableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead className="w-24 text-right">Lines</TableHead>
                <TableHead className="w-28 text-right">Units planned</TableHead>
                <TableHead className="w-32 text-right">Avg / unit</TableHead>
                <TableHead className="w-32 text-right">Planned cost</TableHead>
                <TableHead className="w-32 text-right">Target trade-out</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {types.map((t) => (
                <ClickableTableRow
                  key={t.id}
                  href={`/properties/${propertySlug}/interiors/types/${t.id}`}
                >
                  <TableCell>
                    <Link
                      href={`/properties/${propertySlug}/interiors/types/${t.id}`}
                      className="font-medium text-navy"
                    >
                      {t.name}
                    </Link>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {t.description ??
                        (t.sourceTemplateName ? `From ${t.sourceTemplateName}` : "Built here")}
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {t.lineCount}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {t.plannedUnits > 0 ? t.plannedUnits.toLocaleString() : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {t.avgPerUnit != null ? money(t.avgPerUnit) : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {t.totalCost > 0 ? money(t.totalCost) : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {t.targetTradeOut != null ? `${money(t.targetTradeOut)}/mo` : "—"}
                  </TableCell>
                  <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                    <RowMenu propertyId={propertyId} propertySlug={propertySlug} type={t} />
                  </TableCell>
                </ClickableTableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      )}

      <AddTypeDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        propertyId={propertyId}
        propertySlug={propertySlug}
        templates={templates}
      />
    </div>
  );
}

function RowMenu({
  propertyId,
  propertySlug,
  type,
}: {
  propertyId: number;
  propertySlug: string;
  type: RenovationTypeRow;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [renameOpen, setRenameOpen] = useState(false);

  function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>, success: string) {
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(success);
      router.refresh();
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger disabled={pending} render={<Button variant="ghost" size="icon-sm" />}>
          <EllipsisIcon />
          <span className="sr-only">Actions</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setRenameOpen(true)}>Rename</DropdownMenuItem>
          <DropdownMenuItem
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const res = await duplicateGroup({ id: type.id, propertyId });
                if (!res.ok) {
                  toast.error(res.error);
                  return;
                }
                toast.success("Renovation type duplicated");
                router.push(`/properties/${propertySlug}/interiors/types/${res.groupId}`);
                router.refresh();
              })
            }
          >
            Duplicate
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            disabled={pending}
            onClick={() =>
              run(() => archiveGroup({ id: type.id, propertyId }), "Renovation type archived")
            }
          >
            Archive
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename renovation type</DialogTitle>
            <DialogDescription>
              Units already planned into this type keep their plan; only the label changes.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              const name = String(fd.get("name") ?? "").trim();
              const description = String(fd.get("description") ?? "").trim();
              if (!name) return;
              setRenameOpen(false);
              run(
                () => updateGroup({ id: type.id, propertyId, name, description: description || undefined }),
                "Renovation type updated",
              );
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor={`rt-name-${type.id}`}>Name</Label>
              <Input id={`rt-name-${type.id}`} name="name" defaultValue={type.name} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`rt-desc-${type.id}`}>Description</Label>
              <Input
                id={`rt-desc-${type.id}`}
                name="description"
                defaultValue={type.description ?? ""}
                placeholder="Optional"
              />
            </div>
            <div className="flex justify-end">
              <Button type="submit" disabled={pending}>
                Save
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function AddTypeDialog({
  open,
  onOpenChange,
  propertyId,
  propertySlug,
  templates,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  propertyId: number;
  propertySlug: string;
  templates: TemplateOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function goTo(groupId: number) {
    router.push(`/properties/${propertySlug}/interiors/types/${groupId}`);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add renovation type</DialogTitle>
          <DialogDescription>
            Starting from a portfolio default brings its pricing across. Building from scratch gives
            an empty type you price yourself.
          </DialogDescription>
        </DialogHeader>

        {templates.length > 0 && (
          <form
            className="space-y-3 rounded-card border border-border p-3"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              const templateId = Number(fd.get("templateId"));
              if (!templateId) {
                toast.error("Pick a portfolio default");
                return;
              }
              const name = String(fd.get("name") ?? "").trim();
              startTransition(async () => {
                const res = await createGroupFromTemplate({
                  propertyId,
                  templateId,
                  name: name || undefined,
                });
                if (!res.ok) {
                  toast.error(res.error);
                  return;
                }
                // A chart without the template's codes yields a type with missing
                // lines, which would otherwise look like the copy simply worked.
                toast.success(
                  res.unresolved > 0
                    ? `Created — ${res.unresolved} line(s) had no matching cost code in this property's chart`
                    : "Renovation type created",
                );
                onOpenChange(false);
                goTo(res.groupId);
              });
            }}
          >
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-ink-300">
              From a portfolio default
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rt-template">Default</Label>
              <select
                id="rt-template"
                name="templateId"
                defaultValue=""
                className="h-9 w-full rounded-control border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
              >
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
            <div className="space-y-1.5">
              <Label htmlFor="rt-template-name">Name on this property</Label>
              <Input id="rt-template-name" name="name" placeholder="Defaults to the type's name" />
            </div>
            <div className="flex justify-end">
              <Button type="submit" size="sm" disabled={pending}>
                Create from default
              </Button>
            </div>
          </form>
        )}

        <form
          className="space-y-3 rounded-card border border-border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const name = String(fd.get("name") ?? "").trim();
            if (!name) {
              toast.error("Name is required");
              return;
            }
            startTransition(async () => {
              const res = await createBlankGroup({
                propertyId,
                name,
                description: String(fd.get("description") ?? "").trim() || undefined,
              });
              if (!res.ok) {
                toast.error(res.error);
                return;
              }
              toast.success("Renovation type created");
              onOpenChange(false);
              goTo(res.groupId);
            });
          }}
        >
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-ink-300">
            From scratch
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rt-blank-name">Name</Label>
            <Input id="rt-blank-name" name="name" placeholder="Blended UW" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rt-blank-desc">Description</Label>
            <Input id="rt-blank-desc" name="description" placeholder="Optional" />
          </div>
          <div className="flex justify-end">
            <Button type="submit" size="sm" variant="outline" disabled={pending}>
              Create empty
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

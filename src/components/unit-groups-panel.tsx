"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, MoreHorizontal } from "lucide-react";
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
import { cn } from "@/lib/utils";
import {
  applyGrouping,
  deleteUnitGroup,
  previewGrouping,
  updateUnitGroup,
  type GroupLoss,
} from "@/lib/actions/interior-unit-groups";
import { updateInteriorSettings } from "@/lib/actions/interior-budget-plan";

export type PanelUnitGroup = {
  id: number;
  name: string;
  bedrooms: number | null;
  baths: number | null;
  avgSqft: number | null;
  unitCount: number;
  countOverridden: boolean;
  sqftOverridden: boolean;
  floorPlanCodes: string[];
};
export type InteriorCodeChoice = { id: number; code: string; name: string };

const selectClass =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50";

type ActionKind = "edit" | "delete";

export function UnitGroupsPanel({
  propertyId,
  groups,
  cmCostCodeId,
  contingencyCostCodeId,
  cmPct,
  contingencyPct,
  interiorCodes,
  unmappedFloorplans,
  tierCount,
}: {
  propertyId: number;
  groups: PanelUnitGroup[];
  cmCostCodeId: number | null;
  contingencyCostCodeId: number | null;
  cmPct: number;
  contingencyPct: number;
  interiorCodes: InteriorCodeChoice[];
  unmappedFloorplans: { floorPlanCode: string; unitCount: number }[];
  tierCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState<{ kind: ActionKind; group: PanelUnitGroup } | null>(null);

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger render={<Button size="sm" variant={groups.length ? "outline" : "default"} />}>
          {groups.length ? "Unit groups" : "Set up unit groups"}
        </DialogTrigger>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Unit groups</DialogTitle>
            <DialogDescription>
              One group per floorplan on the latest committed rent roll. Each is a column on the
              interior budget, and its unit count and average square footage come from that rent roll.
            </DialogDescription>
          </DialogHeader>

          {groups.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No groups yet. Seed them from the rent roll below.
            </p>
          ) : (
            /* One group per floorplan means 20+ rows at a real property, which grew the
               dialog past the viewport and left the rows and their menus off-screen and
               unclickable. The list scrolls; the dialog itself stays put. */
            <div className="max-h-[45vh] divide-y overflow-y-auto rounded-md border border-hairline">
              {groups.map((g) => (
                <div key={g.id} className="flex items-start gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-navy">{g.name}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {g.unitCount.toLocaleString()} units
                        {g.countOverridden && <Overridden />}
                        {" · "}
                        {g.avgSqft != null ? `${g.avgSqft.toLocaleString()} SF avg` : "no SF"}
                        {g.sqftOverridden && <Overridden />}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-ink-400">
                      {g.floorPlanCodes.length === 0
                        ? "No floorplans mapped — contributes nothing"
                        : g.floorPlanCodes.slice(0, 8).join(", ") +
                          (g.floorPlanCodes.length > 8 ? ` +${g.floorPlanCodes.length - 8} more` : "")}
                    </p>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" />}>
                      <MoreHorizontal className="size-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => setAction({ kind: "edit", group: g })}>
                        Rename &amp; size
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => setAction({ kind: "delete", group: g })}
                      >
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))}
            </div>
          )}

          {unmappedFloorplans.length > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-hairline bg-alert-bg px-3 py-2 text-xs text-ink-700">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-alert" />
              <span>
                {unmappedFloorplans.length} floorplan{unmappedFloorplans.length === 1 ? "" : "s"} (
                {unmappedFloorplans.reduce((s, f) => s + f.unitCount, 0)} units) are in no group and are
                excluded from the budget. Re-seed below to pick them up.
              </span>
            </div>
          )}

          <ReseedSection propertyId={propertyId} tierCount={tierCount} />

          <UpliftCodesSection
            propertyId={propertyId}
            cmPct={cmPct}
            contingencyPct={contingencyPct}
            cmCostCodeId={cmCostCodeId}
            contingencyCostCodeId={contingencyCostCodeId}
            interiorCodes={interiorCodes}
          />
        </DialogContent>
      </Dialog>

      <GroupActionDialog propertyId={propertyId} action={action} onClose={() => setAction(null)} />
    </>
  );
}

const Overridden = () => (
  <span className="ml-1 text-[10px] text-link" title="Manually set, not from the rent roll">
    (set)
  </span>
);

/**
 * Re-seeding replaces the whole grouping and cascades away the pins and planned
 * tiers of any group it drops, so it's demoted below the list and never applies
 * without an explicit destructive confirmation.
 */
function ReseedSection({ propertyId, tierCount }: { propertyId: number; tierCount: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [preview, setPreview] = useState<{
    keep: { id: number; name: string }[];
    create: { name: string; floorPlanCodes: string[] }[];
    remove: GroupLoss[];
    hasRentRoll: boolean;
  } | null>(null);

  function invalidate() {
    setPreview(null);
    setNeedsConfirm(false);
  }

  async function handlePreview() {
    setBusy(true);
    invalidate();
    try {
      const result = await previewGrouping({ propertyId });
      if (!result.ok) return toast.error(result.error);
      setPreview({
        keep: result.keep,
        create: result.create,
        remove: result.remove,
        hasRentRoll: result.hasRentRoll,
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleApply(confirmed: boolean) {
    setBusy(true);
    try {
      const result = await applyGrouping({ propertyId, confirm: confirmed });
      if (!result.ok) {
        if (!confirmed) setNeedsConfirm(true);
        return toast.error(result.error);
      }
      toast.success(`${result.created} added · ${result.kept} kept · ${result.removed} removed`);
      invalidate();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const destructive = (preview?.remove ?? []).filter(
    (r) => r.pinCount > 0 || r.plannedTierCount > 0,
  );
  const resultingGroups = preview ? preview.keep.length + preview.create.length : 0;
  const wide = preview != null && tierCount > 0 && resultingGroups * tierCount > 12;

  return (
    <details className="rounded-md border border-hairline">
      <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-ink-700">
        Re-seed from rent roll
      </summary>
      <div className="space-y-3 border-t border-hairline px-3 py-3">
        <p className="text-[11px] text-muted-foreground">
          Rebuilds the columns as one group per floorplan type on the rent roll, picking up floorplans
          added since the last seed.
        </p>

        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={handlePreview} disabled={busy}>
            {busy ? "Checking…" : "Preview changes"}
          </Button>
          {preview &&
            (needsConfirm ? (
              <Button
                type="button"
                size="sm"
                variant="destructive"
                onClick={() => handleApply(true)}
                disabled={busy}
              >
                Discard {destructive.length} group{destructive.length === 1 ? "" : "s"} and apply
              </Button>
            ) : (
              <Button type="button" size="sm" onClick={() => handleApply(false)} disabled={busy}>
                Apply
              </Button>
            ))}
        </div>

        {preview && !preview.hasRentRoll && (
          <p className="text-xs text-muted-foreground">
            No committed rent roll, so groups can&apos;t be seeded automatically.
          </p>
        )}

        {preview && preview.hasRentRoll && (
          <div className="space-y-2 rounded border border-hairline p-2.5 text-xs">
            <p className="text-ink-700">
              <strong>{preview.create.length}</strong> to add ·{" "}
              <strong>{preview.keep.length}</strong> unchanged ·{" "}
              <strong>{preview.remove.length}</strong> to remove
            </p>
            {wide && (
              <p className="text-ink-500">
                Results in {resultingGroups} groups × {tierCount} tier{tierCount === 1 ? "" : "s"} ={" "}
                <strong>{resultingGroups * tierCount} columns</strong> — the table will be very wide.
              </p>
            )}
            {destructive.length > 0 && (
              <div className="flex items-start gap-2 rounded border border-hairline bg-alert-bg px-2 py-1.5">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-alert" />
                <span className="text-ink-700">
                  Discards{" "}
                  {destructive
                    .map(
                      (r) =>
                        `"${r.name}" (${r.pinCount} pinned, ${r.plannedTierCount} planned tier${r.plannedTierCount === 1 ? "" : "s"})`,
                    )
                    .join(", ")}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </details>
  );
}

/** Which cost codes the uplift dollars post to — structural, so not inline on the pivot. */
function UpliftCodesSection({
  propertyId,
  cmPct,
  contingencyPct,
  cmCostCodeId,
  contingencyCostCodeId,
  interiorCodes,
}: {
  propertyId: number;
  cmPct: number;
  contingencyPct: number;
  cmCostCodeId: number | null;
  contingencyCostCodeId: number | null;
  interiorCodes: InteriorCodeChoice[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const result = await updateInteriorSettings({
        propertyId,
        cmSupervisionPct: cmPct,
        contingencyPct,
        cmCostCodeId: fd.get("cmCostCodeId") ? Number(fd.get("cmCostCodeId")) : undefined,
        contingencyCostCodeId: fd.get("contingencyCostCodeId")
          ? Number(fd.get("contingencyCostCodeId"))
          : undefined,
      });
      if (!result.ok) return toast.error(result.error);
      toast.success("Uplift cost codes saved");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="rounded-md border border-hairline">
      <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-ink-700">
        Where uplift dollars post
      </summary>
      <form className="space-y-3 border-t border-hairline px-3 py-3" onSubmit={handleSubmit}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="ug-cm-code">CM / supervision</Label>
            <select
              id="ug-cm-code"
              name="cmCostCodeId"
              defaultValue={cmCostCodeId ?? ""}
              className={selectClass}
            >
              <option value="">Not attributed</option>
              {interiorCodes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ug-cont-code">Contingency</Label>
            <select
              id="ug-cont-code"
              name="contingencyCostCodeId"
              defaultValue={contingencyCostCodeId ?? ""}
              className={selectClass}
            >
              <option value="">Not attributed</option>
              {interiorCodes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Without these the uplift dollars sit outside the cost-code tree and the interior budget stops
          matching the Interiors division on the other views. Rates themselves are edited on the pivot.
        </p>
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={busy}>
            Save
          </Button>
        </div>
      </form>
    </details>
  );
}

// ---------------------------------------------------------------------------

function GroupActionDialog({
  propertyId,
  action,
  onClose,
}: {
  propertyId: number;
  action: { kind: ActionKind; group: PanelUnitGroup } | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [needsConfirm, setNeedsConfirm] = useState(false);

  const key = action ? `${action.kind}:${action.group.id}` : "";
  const [lastKey, setLastKey] = useState("");
  if (action && key !== lastKey) {
    setLastKey(key);
    setNeedsConfirm(false);
  }

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) {
    setBusy(true);
    try {
      const result = await fn();
      if (!result.ok) return toast.error(result.error ?? "Something went wrong");
      toast.success(ok);
      onClose();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!action) return <Dialog open={false} onOpenChange={() => {}} />;
  const g = action.group;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        {action.kind === "edit" && (
          <>
            <DialogHeader>
              <DialogTitle>{g.name}</DialogTitle>
              <DialogDescription>
                Leave a size blank to keep deriving it from the rent roll.
              </DialogDescription>
            </DialogHeader>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                const numOrNull = (k: string) => {
                  const v = String(fd.get(k) ?? "").trim();
                  return v === "" ? undefined : Number(v);
                };
                void run(
                  () =>
                    updateUnitGroup({
                      id: g.id,
                      propertyId,
                      name: String(fd.get("name") ?? ""),
                      bedrooms: g.bedrooms,
                      baths: g.baths,
                      unitCountOverride: numOrNull("unitCount"),
                      avgSqftOverride: numOrNull("avgSqft"),
                    }),
                  "Group updated",
                );
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="ug-name">Name</Label>
                <Input id="ug-name" name="name" defaultValue={g.name} required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="ug-count">Unit count</Label>
                  <Input
                    id="ug-count"
                    name="unitCount"
                    type="number"
                    min="0"
                    step="1"
                    defaultValue={g.countOverridden ? g.unitCount : ""}
                    placeholder={`${g.unitCount} from rent roll`}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ug-sqft">Avg SF</Label>
                  <Input
                    id="ug-sqft"
                    name="avgSqft"
                    type="number"
                    min="0"
                    step="0.01"
                    defaultValue={g.sqftOverridden ? (g.avgSqft ?? "") : ""}
                    placeholder={g.avgSqft != null ? `${g.avgSqft} from rent roll` : "none on file"}
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <Button type="submit" disabled={busy}>
                  Save
                </Button>
              </div>
            </form>
          </>
        )}

        {action.kind === "delete" && (
          <>
            <DialogHeader>
              <DialogTitle>Delete {g.name}?</DialogTitle>
              <DialogDescription>
                Its {g.floorPlanCodes.length} floorplan
                {g.floorPlanCodes.length === 1 ? "" : "s"} become unmapped and their units drop out of
                the interior budget.
              </DialogDescription>
            </DialogHeader>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const result = await deleteUnitGroup({
                      id: g.id,
                      propertyId,
                      confirm: needsConfirm,
                    });
                    if (!result.ok) {
                      if (!needsConfirm) setNeedsConfirm(true);
                      return toast.error(result.error);
                    }
                    toast.success("Group deleted");
                    onClose();
                    router.refresh();
                  } finally {
                    setBusy(false);
                  }
                }}
                className={cn(needsConfirm && "ring-2 ring-destructive/40")}
              >
                {needsConfirm ? "Delete anyway" : "Delete"}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

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
  mergeUnitGroups,
  previewGrouping,
  splitUnitGroup,
  updateUnitGroup,
  type GroupLoss,
} from "@/lib/actions/interior-unit-groups";
import { updateInteriorSettings } from "@/lib/actions/interior-budget-plan";
import type { GroupingMode } from "@/lib/interior-unit-grouping";

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

const MODE_HELP: Record<GroupingMode, string> = {
  beds: "One group per bedroom count — Studio, 1BR, 2BR. Usually what underwriting wants.",
  floorplan: "One group per floorplan code. Granular, and produces a lot of columns.",
  sqft: "One group per square-footage band.",
};

type ActionKind = "edit" | "split" | "merge" | "delete";

export function UnitGroupsPanel({
  propertyId,
  groups,
  groupingMode,
  sqftBreakpoints,
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
  groupingMode: GroupingMode;
  sqftBreakpoints: number[] | null;
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
              Each group is a column on the interior budget, and its unit count and average square
              footage come from the latest committed rent roll.
            </DialogDescription>
          </DialogHeader>

          {groups.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No groups yet. Seed them from the rent roll below.
            </p>
          ) : (
            <div className="divide-y rounded-md border border-hairline">
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
                      <DropdownMenuItem
                        disabled={g.floorPlanCodes.length < 2}
                        onClick={() => setAction({ kind: "split", group: g })}
                      >
                        Split out floorplans…
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={groups.length < 2}
                        onClick={() => setAction({ kind: "merge", group: g })}
                      >
                        Merge into…
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

          <ReseedSection
            propertyId={propertyId}
            groupingMode={groupingMode}
            sqftBreakpoints={sqftBreakpoints}
            tierCount={tierCount}
          />

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

      <GroupActionDialog
        propertyId={propertyId}
        action={action}
        groups={groups}
        onClose={() => setAction(null)}
      />
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
function ReseedSection({
  propertyId,
  groupingMode,
  sqftBreakpoints,
  tierCount,
}: {
  propertyId: number;
  groupingMode: GroupingMode;
  sqftBreakpoints: number[] | null;
  tierCount: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<GroupingMode>(groupingMode);
  const [breakpoints, setBreakpoints] = useState((sqftBreakpoints ?? []).join(", "));
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [preview, setPreview] = useState<{
    keep: { id: number; name: string }[];
    create: { name: string; floorPlanCodes: string[] }[];
    remove: GroupLoss[];
    hasRentRoll: boolean;
  } | null>(null);

  const parsed = breakpoints
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);

  function invalidate() {
    setPreview(null);
    setNeedsConfirm(false);
  }

  async function handlePreview() {
    setBusy(true);
    invalidate();
    try {
      const result = await previewGrouping({
        propertyId,
        mode,
        sqftBreakpoints: mode === "sqft" ? parsed : null,
      });
      if (!result.ok) return toast.error(result.error);
      setPreview({
        keep: result.keep,
        create: result.create,
        remove: result.remove,
        hasRentRoll: result.hasRentRoll,
      });
      if (mode === "sqft" && parsed.length === 0 && result.suggestedBreakpoints.length) {
        setBreakpoints(result.suggestedBreakpoints.join(", "));
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleApply(confirmed: boolean) {
    setBusy(true);
    try {
      const result = await applyGrouping({
        propertyId,
        mode,
        sqftBreakpoints: mode === "sqft" ? parsed : null,
        confirm: confirmed,
      });
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
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="ug-mode">Group units by</Label>
            <select
              id="ug-mode"
              value={mode}
              onChange={(e) => {
                setMode(e.target.value as GroupingMode);
                invalidate();
              }}
              className={selectClass}
            >
              <option value="beds">Bedroom count</option>
              <option value="floorplan">Floorplan type</option>
              <option value="sqft">Square footage band</option>
            </select>
          </div>
          {mode === "sqft" && (
            <div className="space-y-1.5">
              <Label htmlFor="ug-breaks">Band edges (SF)</Label>
              <Input
                id="ug-breaks"
                value={breakpoints}
                onChange={(e) => {
                  setBreakpoints(e.target.value);
                  invalidate();
                }}
                placeholder="700, 900, 1100"
              />
            </div>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">{MODE_HELP[mode]}</p>

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
  groups,
  onClose,
}: {
  propertyId: number;
  action: { kind: ActionKind; group: PanelUnitGroup } | null;
  groups: PanelUnitGroup[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);

  const key = action ? `${action.kind}:${action.group.id}` : "";
  const [lastKey, setLastKey] = useState("");
  if (action && key !== lastKey) {
    setLastKey(key);
    setNeedsConfirm(false);
    setPicked([]);
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

        {action.kind === "split" && (
          <>
            <DialogHeader>
              <DialogTitle>Split {g.name}</DialogTitle>
              <DialogDescription>
                Pick the floorplans to move into a new group. {g.name} keeps its pinned amounts and
                planned tiers.
              </DialogDescription>
            </DialogHeader>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                void run(
                  () =>
                    splitUnitGroup({
                      propertyId,
                      unitGroupId: g.id,
                      name: String(fd.get("name") ?? ""),
                      floorPlanCodes: picked,
                    }),
                  "Group split",
                );
              }}
            >
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-hairline p-2">
                {g.floorPlanCodes.map((code) => (
                  <label key={code} className="flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={picked.includes(code)}
                      onChange={(e) =>
                        setPicked((prev) =>
                          e.target.checked ? [...prev, code] : prev.filter((c) => c !== code),
                        )
                      }
                    />
                    <span className="text-ink-700">{code || "(blank)"}</span>
                  </label>
                ))}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ug-split-name">New group name</Label>
                <Input id="ug-split-name" name="name" required placeholder="1BR — large" />
              </div>
              <div className="flex justify-end">
                <Button
                  type="submit"
                  disabled={busy || picked.length === 0 || picked.length === g.floorPlanCodes.length}
                >
                  Split out {picked.length || ""}
                </Button>
              </div>
            </form>
          </>
        )}

        {action.kind === "merge" && (
          <>
            <DialogHeader>
              <DialogTitle>Merge {g.name} into another group</DialogTitle>
              <DialogDescription>
                {g.name}&apos;s floorplans move to the target and {g.name} is deleted — its pinned
                amounts and planned tiers go with it. The target keeps its own.
              </DialogDescription>
            </DialogHeader>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                void run(
                  () =>
                    mergeUnitGroups({
                      propertyId,
                      targetId: Number(fd.get("targetId")),
                      sourceIds: [g.id],
                    }),
                  "Groups merged",
                );
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="ug-target">Merge into</Label>
                <select id="ug-target" name="targetId" required defaultValue="" className={selectClass}>
                  <option value="" disabled>
                    Select…
                  </option>
                  {groups
                    .filter((o) => o.id !== g.id)
                    .map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                </select>
              </div>
              <div className="flex justify-end">
                <Button type="submit" variant="destructive" disabled={busy}>
                  Merge
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

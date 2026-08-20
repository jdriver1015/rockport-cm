"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Check, ChevronLeft, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { addUnitRenovation, removePlanCell } from "@/lib/actions/interior-budget-plan";

/** A rent-roll floorplan, with how much of it is already committed. */
export type WizardFloorplan = {
  floorPlanCode: string;
  unitCount: number;
  avgSqft: number | null;
  /** Units already planned into renovation types, across all of them. */
  planned: number;
  /** Null when this floorplan has no unit group yet. */
  unitGroupId: number | null;
};
export type WizardTier = { id: number; name: string };

/** An existing pivot column — one unit group × tier pair. */
export type WizardExistingColumn = {
  unitGroupId: number;
  tierId: number;
  groupName: string;
  tierName: string;
  plannedUnits: number;
  avgSqft: number | null;
};

/**
 * Add one floorplan × renovation type to the interior budget.
 *
 * Deliberately a wizard rather than one form: the floorplan governs how many units
 * are even available, so asking for a count before a floorplan invites a number
 * that has to be rejected.
 */
export function AddUnitRenovationWizard({
  propertyId,
  floorplans,
  tiers,
  existingColumns = [],
  open,
  onClose,
}: {
  propertyId: number;
  floorplans: WizardFloorplan[];
  tiers: WizardTier[];
  existingColumns?: WizardExistingColumn[];
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<WizardExistingColumn | null>(null);
  const [listTab, setListTab] = useState<"available" | "existing">("available");
  const [code, setCode] = useState<string | null>(null);
  const [tierId, setTierId] = useState<number | null>(null);
  const [units, setUnits] = useState("");

  const floorplan = floorplans.find((f) => f.floorPlanCode === code) ?? null;
  const tier = tiers.find((t) => t.id === tierId) ?? null;
  const remaining = floorplan ? floorplan.unitCount - floorplan.planned : 0;

  const parsed = Number(units);
  const unitsValid =
    units.trim() !== "" && Number.isInteger(parsed) && parsed > 0 && parsed <= remaining;

  function reset() {
    setStep(1);
    setCode(null);
    setTierId(null);
    setUnits("");
  }

  async function handleRemove(col: WizardExistingColumn) {
    setBusy(true);
    try {
      const result = await removePlanCell({
        propertyId,
        unitGroupId: col.unitGroupId,
        budgetGroupId: col.tierId,
      });
      if (!result.ok) return toast.error(result.error);
      toast.success(`Removed ${col.groupName} · ${col.tierName}`);
      setConfirmRemove(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function pickFloorplan(f: WizardFloorplan) {
    setCode(f.floorPlanCode);
    // Default to everything still unplanned — the common case is renovating the
    // whole classic floorplan, and it's easier to type down than up.
    setUnits(String(f.unitCount - f.planned));
    setStep(2);
  }

  function pickTier(id: number) {
    setTierId(id);
    setStep(3);
  }

  async function handleSubmit() {
    if (!code || !tierId || !unitsValid) return;
    setBusy(true);
    try {
      const result = await addUnitRenovation({
        propertyId,
        floorPlanCode: code,
        budgetGroupId: tierId,
        units: parsed,
      });
      if (!result.ok) return toast.error(result.error);
      toast.success(`Added ${parsed} ${code} unit${parsed === 1 ? "" : "s"} to ${tier?.name}`);
      reset();
      onClose();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Plan units into renovation types</DialogTitle>
          <DialogDescription>
            {step === 1
              ? "Add a new floorplan or manage existing groups."
              : step === 2
                ? `What renovation goes into ${code || "this floorplan"}?`
                : `How many ${code} units get ${tier?.name}?`}
          </DialogDescription>
        </DialogHeader>

        {step > 1 && <StepDots step={step} />}

        {step === 1 && (
          <div className="space-y-2">
            {confirmRemove && (
              <div className="flex items-start gap-2 rounded-md border border-alert/30 bg-alert-bg px-3 py-2.5">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-alert" />
                <div className="min-w-0 flex-1 space-y-2">
                  <p className="text-xs text-ink-700">
                    Remove <span className="font-semibold">{confirmRemove.groupName} · {confirmRemove.tierName}</span>?
                    This deletes planned units and custom overrides for this column.
                  </p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="destructive" disabled={busy}
                      onClick={() => handleRemove(confirmRemove)}>
                      {busy ? "Removing…" : "Remove"}
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy}
                      onClick={() => setConfirmRemove(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              </div>
            )}
            <PillSwitch value={listTab} onChange={setListTab} existingCount={existingColumns.length} />
            {listTab === "available" ? (
              <AvailableList floorplans={floorplans} onPick={pickFloorplan} />
            ) : (
              <ExistingList columns={existingColumns} onRemove={setConfirmRemove} />
            )}
          </div>
        )}

        {step === 2 && (
          <div className="divide-y rounded-md border border-hairline">
            {tiers.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => pickTier(t.id)}
                className="flex w-full items-center justify-between px-3 py-2.5 text-left hover:bg-hover"
              >
                <span className="font-medium text-navy">{t.name}</span>
                {tierId === t.id && <Check className="size-4 text-link" />}
              </button>
            ))}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-1.5">
            <Label htmlFor="wiz-units">Units</Label>
            <Input
              id="wiz-units"
              type="number"
              min="1"
              max={remaining}
              step="1"
              value={units}
              onChange={(e) => setUnits(e.target.value)}
            />
            <p
              className={cn(
                "text-[11px]",
                units.trim() !== "" && !unitsValid ? "text-alert" : "text-muted-foreground",
              )}
            >
              {units.trim() === ""
                ? `Up to ${remaining} available.`
                : !Number.isInteger(parsed) || parsed <= 0
                  ? "Enter a whole number of units, at least 1."
                  : parsed > remaining
                    ? `Only ${remaining} of ${floorplan?.unitCount} ${code} units are unplanned.`
                    : `${Math.round((parsed / (floorplan?.unitCount || 1)) * 1000) / 10}% of ${floorplan?.unitCount} ${code} units.`}
            </p>
          </div>
        )}

        <DialogFooter className="sm:justify-between">
          {step > 1 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setStep(step - 1)}
              disabled={busy}
            >
              <ChevronLeft className="size-4" />
              Back
            </Button>
          ) : (
            <span />
          )}
          {step === 3 && (
            <Button type="button" onClick={handleSubmit} disabled={busy || !unitsValid}>
              {busy ? "Adding…" : "Add renovation"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PillSwitch({
  value,
  onChange,
  existingCount,
}: {
  value: "available" | "existing";
  onChange: (v: "available" | "existing") => void;
  existingCount: number;
}) {
  return (
    <div className="flex gap-1 rounded-lg bg-band p-0.5">
      {([
        { key: "available" as const, label: "Available" },
        { key: "existing" as const, label: `Existing (${existingCount})` },
      ]).map(({ key, label }) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className={cn(
            "flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            value === key
              ? "bg-white text-navy shadow-sm"
              : "text-ink-400 hover:text-ink-700",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function AvailableList({
  floorplans,
  onPick,
}: {
  floorplans: WizardFloorplan[];
  onPick: (f: WizardFloorplan) => void;
}) {
  const available = floorplans.filter((f) => f.unitCount - f.planned > 0);
  if (available.length === 0) {
    return (
      <div className="rounded-md border border-hairline">
        <p className="px-3 py-6 text-center text-sm text-muted-foreground">
          All floorplans are fully planned.
        </p>
      </div>
    );
  }
  return (
    <div className="max-h-[45vh] divide-y divide-hairline overflow-y-auto rounded-md border border-hairline">
      {available.map((f) => {
        const left = f.unitCount - f.planned;
        return (
          <button
            key={f.floorPlanCode}
            type="button"
            onClick={() => onPick(f)}
            className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-hover"
          >
            <span className="font-medium text-navy">
              {f.floorPlanCode || "(blank)"}
            </span>
            <span className="text-xs tabular-nums text-muted-foreground">
              {left} of {f.unitCount} unplanned
              {f.avgSqft != null && ` · ${f.avgSqft.toLocaleString()} SF avg`}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ExistingList({
  columns,
  onRemove,
}: {
  columns: WizardExistingColumn[];
  onRemove: (col: WizardExistingColumn) => void;
}) {
  if (columns.length === 0) {
    return (
      <div className="rounded-md border border-hairline">
        <p className="px-3 py-6 text-center text-sm text-muted-foreground">
          No unit groups in the budget yet.
        </p>
      </div>
    );
  }
  return (
    <div className="max-h-[45vh] divide-y divide-hairline overflow-y-auto rounded-md border border-hairline">
      {columns.map((col) => (
        <div
          key={`${col.unitGroupId}:${col.tierId}`}
          className="flex items-center gap-1"
        >
          <div className="flex min-w-0 flex-1 items-center justify-between gap-3 px-3 py-2.5">
            <span className="font-medium text-navy">
              {col.groupName}
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">{col.tierName}</span>
            </span>
            <span className="text-xs tabular-nums text-muted-foreground">
              {col.plannedUnits} unit{col.plannedUnits === 1 ? "" : "s"}
              {col.avgSqft != null && ` · ${col.avgSqft.toLocaleString()} SF avg`}
            </span>
          </div>
          <button
            type="button"
            title={`Remove ${col.groupName} · ${col.tierName}`}
            onClick={() => onRemove(col)}
            className="mr-1.5 flex size-7 shrink-0 items-center justify-center rounded-md text-ink-300 transition-colors hover:bg-alert-bg hover:text-alert"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

function StepDots({ step }: { step: number }) {
  const labels = ["Floorplan", "Renovation", "Units"];
  return (
    <div className="flex items-center gap-1.5 text-[11px]">
      {labels.map((label, i) => (
        <div key={label} className="flex items-center gap-1.5">
          <span
            className={cn(
              "flex size-4 items-center justify-center rounded-full text-[9px] font-semibold",
              i + 1 === step
                ? "bg-navy text-white"
                : i + 1 < step
                  ? "bg-link/15 text-link"
                  : "bg-band text-ink-400",
            )}
          >
            {i + 1 < step ? "✓" : i + 1}
          </span>
          <span className={cn(i + 1 === step ? "font-medium text-navy" : "text-ink-400")}>
            {label}
          </span>
          {i < labels.length - 1 && <span className="px-1 text-ink-300">→</span>}
        </div>
      ))}
    </div>
  );
}

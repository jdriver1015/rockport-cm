"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, ChevronLeft } from "lucide-react";
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
import { addUnitRenovation } from "@/lib/actions/interior-budget-plan";

/** A rent-roll floorplan, with how much of it is already committed. */
export type WizardFloorplan = {
  floorPlanCode: string;
  unitCount: number;
  avgSqft: number | null;
  /** Units already planned into renovation types, across all of them. */
  planned: number;
};
export type WizardTier = { id: number; name: string };

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
  open,
  onClose,
}: {
  propertyId: number;
  floorplans: WizardFloorplan[];
  tiers: WizardTier[];
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
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
          <DialogTitle>Add unit renovation</DialogTitle>
          <DialogDescription>
            {step === 1
              ? "Which floorplan are the units coming from?"
              : step === 2
                ? `What renovation goes into ${code || "this floorplan"}?`
                : `How many ${code} units get ${tier?.name}?`}
          </DialogDescription>
        </DialogHeader>

        <StepDots step={step} />

        {step === 1 && (
          <div className="max-h-[45vh] divide-y overflow-y-auto rounded-md border border-hairline">
            {floorplans.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                No floorplans on the latest committed rent roll.
              </p>
            ) : (
              floorplans.map((f) => {
                const left = f.unitCount - f.planned;
                const full = left <= 0;
                return (
                  <button
                    key={f.floorPlanCode}
                    type="button"
                    disabled={full}
                    onClick={() => pickFloorplan(f)}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left",
                      full ? "cursor-not-allowed opacity-50" : "hover:bg-hover",
                    )}
                  >
                    <span className="font-medium text-navy">
                      {f.floorPlanCode || "(blank)"}
                    </span>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {full
                        ? "fully planned"
                        : `${left} of ${f.unitCount} unplanned`}
                      {f.avgSqft != null && ` · ${f.avgSqft.toLocaleString()} SF avg`}
                    </span>
                  </button>
                );
              })
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

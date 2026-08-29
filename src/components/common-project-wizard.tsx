"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { money } from "@/lib/format";
import { createCommonProject } from "@/lib/actions/common-projects";
import { TargetPhasingStep } from "@/components/target-phasing-step";
import { DEFAULT_MILESTONES } from "@/lib/milestones";
import {
  DEFAULT_SCHEDULE,
  blankSchedule,
  type ScheduleKey,
  type ScheduleSettings,
} from "@/lib/schedule-defaults";

export type BudgetLineOption = {
  costCodeId: number;
  code: string;
  name: string;
  approved: number;
  allocated: number;
};

type Line = {
  key: number;
  item: string;
  costCodeId: number;
  quantity: string;
  unitPrice: string;
};

const STEPS = ["Project", "Scope", "Target phasing", "Create"];

let nextKey = 1;
const blankLine = (costCodeId: number): Line => ({
  key: nextKey++,
  item: "",
  costCodeId,
  quantity: "1",
  unitPrice: "",
});

const lineTotal = (l: Line) => (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0);

export function CommonProjectWizard({
  propertyId,
  propertySlug,
  budgetLines,
  schedule,
  suggestedDates,
}: {
  propertyId: number;
  propertySlug: string;
  /** The property's UW lines, with what is already spoken for on each. */
  budgetLines: BudgetLineOption[];
  schedule?: ScheduleSettings;
  /**
   * Prefilled on the server against one fixed timezone. Not derived here from
   * `new Date()`: this renders on both sides of hydration and that produced two
   * different answers.
   */
  suggestedDates?: Record<ScheduleKey, string>;
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState("");
  const [costCodeId, setCostCodeId] = useState<number | null>(null);
  const [lines, setLines] = useState<Line[]>([]);

  const scheduleSettings = schedule ?? DEFAULT_SCHEDULE;
  const [suggested] = useState<Record<ScheduleKey, string>>(
    () => suggestedDates ?? blankSchedule(),
  );
  const [dates, setDates] = useState<Record<ScheduleKey, string>>(suggested);
  function setDate(key: ScheduleKey, value: string) {
    setDates((prev) => ({ ...prev, [key]: value }));
  }

  const uwLine = budgetLines.find((b) => b.costCodeId === costCodeId) ?? null;
  const total = useMemo(() => lines.reduce((n, l) => n + lineTotal(l), 0), [lines]);

  // What is left on the line this project draws from, once this project's own
  // scope is counted. Shown rather than enforced: going over an underwritten
  // allowance is a real decision somebody makes, and the app's job is to make
  // sure they make it knowingly.
  const remaining = uwLine ? uwLine.approved - uwLine.allocated - total : null;

  function addLine() {
    if (costCodeId == null) return;
    setLines((prev) => [...prev, blankLine(costCodeId)]);
  }
  function patchLine(key: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function removeLine(key: number) {
    setLines((prev) => prev.filter((l) => l.key !== key));
  }

  const namedLines = lines.filter((l) => l.item.trim());
  const canNext =
    (step === 0 && name.trim().length > 0 && costCodeId != null) || step === 1 || step === 2;

  async function handleCreate() {
    if (costCodeId == null) return;
    setBusy(true);
    try {
      const result = await createCommonProject({
        propertyId,
        name: name.trim(),
        costCodeId,
        milestones: DEFAULT_MILESTONES.map((m) => ({
          phase: m.phase,
          plannedDate: dates[m.phase] || undefined,
        })),
        lines: namedLines.map((l) => ({
          item: l.item.trim(),
          costCodeId: l.costCodeId,
          quantity: Number(l.quantity) || 0,
          unitPrice: Number(l.unitPrice) || 0,
        })),
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${name.trim()} created`);
      router.push(`/properties/${propertySlug}/projects/${result.slug}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-5 pt-5">
        <div>
          <h1 className="font-heading text-xl text-navy">New common-area project</h1>
          <Stepper step={step} />
        </div>

        {/* Step 1 — what it is and what it spends against */}
        {step === 0 && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="cp-name">Project name</Label>
              <Input
                id="cp-name"
                value={name}
                autoFocus
                placeholder="Dog Park Fence"
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cp-code">Budget category</Label>
              <p className="text-[11.5px] text-muted-foreground">
                The underwritten line this project spends against. Each one shows what is left
                after the scope already committed elsewhere on the property.
              </p>
              {budgetLines.length === 0 ? (
                <p className="rounded-control bg-alert-bg px-2.5 py-1.5 text-[12px] text-alert">
                  This property has no budget lines yet. Add one on the Budget tab first — a
                  project with nothing to spend against cannot be reconciled later.
                </p>
              ) : (
                <select
                  id="cp-code"
                  value={costCodeId ?? ""}
                  onChange={(e) => {
                    const next = e.target.value ? Number(e.target.value) : null;
                    setCostCodeId(next);
                    // Lines default to the project's own code, so re-pointing the
                    // project moves any line still on the old default with it.
                    if (next != null) {
                      setLines((prev) =>
                        prev.map((l) =>
                          l.costCodeId === costCodeId ? { ...l, costCodeId: next } : l,
                        ),
                      );
                    }
                  }}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <option value="">Select a budget category…</option>
                  {budgetLines.map((b) => (
                    <option key={b.costCodeId} value={b.costCodeId}>
                      {b.name} — {money(b.approved - b.allocated)} left of {money(b.approved)}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
        )}

        {/* Step 2 — the scope, which is also the budget */}
        {step === 1 && (
          <div className="space-y-3">
            <div className="space-y-1">
              <p className="text-[13px] leading-relaxed text-ink-600">
                What is being built. Each line is priced, and the project&apos;s budget is what
                they add up to — there is no separate budget to type.
              </p>
              <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                You can leave this empty and price it later; the project is created either way and
                shows as unpriced until somebody does.
              </p>
            </div>

            {lines.length > 0 && (
              <div className="divide-y divide-hairline rounded-card border border-border">
                <div className="grid grid-cols-[1fr_5rem_7rem_6rem_2rem] gap-2 bg-muted/40 px-3 py-1.5 text-[10.5px] font-semibold tracking-[0.09em] text-ink-300 uppercase">
                  <div>Item</div>
                  <div className="text-right">Qty</div>
                  <div className="text-right">Unit cost</div>
                  <div className="text-right">Total</div>
                  <div />
                </div>
                {lines.map((l) => (
                  <div
                    key={l.key}
                    className="grid grid-cols-[1fr_5rem_7rem_6rem_2rem] items-center gap-2 px-3 py-2"
                  >
                    <Input
                      value={l.item}
                      placeholder="Replace perimeter fencing"
                      className="h-8 text-[13px]"
                      onChange={(e) => patchLine(l.key, { item: e.target.value })}
                    />
                    <Input
                      value={l.quantity}
                      type="number"
                      step="0.01"
                      className="h-8 text-right text-[13px]"
                      onChange={(e) => patchLine(l.key, { quantity: e.target.value })}
                    />
                    <Input
                      value={l.unitPrice}
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      className="h-8 text-right text-[13px]"
                      onChange={(e) => patchLine(l.key, { unitPrice: e.target.value })}
                    />
                    <div className="text-right text-[13px] tabular-nums">
                      {l.unitPrice ? money(lineTotal(l)) : "—"}
                    </div>
                    <button
                      type="button"
                      aria-label="Remove line"
                      onClick={() => removeLine(l.key)}
                      className="text-ink-300 hover:text-alert"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                ))}
                <div className="flex items-center justify-between bg-muted/40 px-3 py-2 text-[13px]">
                  <span className="font-medium text-navy">Project budget</span>
                  <span className="font-semibold text-navy tabular-nums">{money(total)}</span>
                </div>
              </div>
            )}

            <Button variant="outline" size="sm" onClick={addLine}>
              Add a scope line
            </Button>

            {uwLine && remaining !== null && (
              <p
                className={cn(
                  "rounded-control px-2.5 py-1.5 text-[12px]",
                  remaining < 0 ? "bg-alert-bg text-alert" : "bg-muted text-muted-foreground",
                )}
              >
                {remaining < 0 ? (
                  <>
                    This is {money(Math.abs(remaining))} over the {uwLine.name} allowance. Allowed —
                    but it will show as over budget from day one.
                  </>
                ) : (
                  <>
                    {money(remaining)} would still be left on {uwLine.name} after this project.
                  </>
                )}
              </p>
            )}
          </div>
        )}

        {/* Step 3 — the same phasing step the interior wizard uses */}
        {step === 2 && (
          <TargetPhasingStep
            dates={dates}
            setDate={setDate}
            onReset={() => setDates(suggested)}
            suggested={suggested}
            schedule={scheduleSettings}
            // A common-area project is not scoped by walking a unit.
            showPreWalk={false}
            noun="the whole job"
          />
        )}

        {/* Step 4 — confirm */}
        {step === 3 && (
          <div className="space-y-2 text-sm">
            <Summary label="Name" value={name.trim() || "—"} />
            <Summary label="Budget category" value={uwLine?.name ?? "—"} />
            <Summary label="Scope lines" value={String(namedLines.length)} />
            <Summary label="Pre-Construction begins" value={dates.precon || "—"} />
            <Summary label="In Process begins" value={dates.in_process || "—"} />
            <Summary label="Punch begins" value={dates.punch || "—"} />
            <Summary label="Target finish" value={dates.complete || "—"} />
            <div className="flex items-center justify-between border-t pt-2 font-semibold text-navy">
              <span>Budget from scope</span>
              <span className="tabular-nums">{namedLines.length > 0 ? money(total) : "Not priced yet"}</span>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between border-t pt-3">
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              onClick={() => setStep((s) => s - 1)}
              disabled={step === 0 || busy}
            >
              Back
            </Button>
            <Button
              variant="ghost"
              onClick={() => router.push(`/properties/${propertySlug}`)}
              disabled={busy}
            >
              Cancel
            </Button>
          </div>
          {step < STEPS.length - 1 ? (
            <Button onClick={() => setStep((s) => s + 1)} disabled={!canNext}>
              Next
            </Button>
          ) : (
            <Button onClick={handleCreate} disabled={busy || !name.trim() || costCodeId == null}>
              {busy ? "Creating…" : "Create project"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Stepper({ step }: { step: number }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
      {STEPS.map((label, i) => (
        <span key={label} className="flex items-center gap-1.5">
          <span
            className={cn(
              "flex size-5 items-center justify-center rounded-full text-[10px] font-semibold",
              i < step
                ? "bg-positive text-white"
                : i === step
                  ? "bg-navy text-white"
                  : "bg-muted text-muted-foreground",
            )}
          >
            {i < step ? <Check className="size-3" /> : i + 1}
          </span>
          <span className={cn(i === step ? "font-medium text-navy" : "text-muted-foreground")}>
            {label}
          </span>
          {i < STEPS.length - 1 && <span className="mx-0.5 text-muted-foreground">›</span>}
        </span>
      ))}
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-navy">{value}</span>
    </div>
  );
}

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
import { BudgetCategoryPicker } from "@/components/budget-category-picker";
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
  /** Which of the four divisions it sits under, for grouping the picker. */
  division: string | null;
  categoryName: string | null;
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
  const [lines, setLines] = useState<Line[]>([]);
  const [categories, setCategories] = useState<Set<number>>(new Set());

  /**
   * Picking a category seeds a scope line for it; unpicking removes its lines.
   *
   * Reconciled rather than regenerated, so going back to change one choice does
   * not silently discard the amounts already typed against the others. A line
   * added by hand on the scope step has no category ticked here and is left
   * alone entirely.
   */
  function toggleCategory(costCodeId: number, next: boolean) {
    setCategories((prev) => {
      const out = new Set(prev);
      if (next) out.add(costCodeId);
      else out.delete(costCodeId);
      return out;
    });
    setLines((prev) => {
      if (!next) return prev.filter((l) => l.costCodeId !== costCodeId);
      if (prev.some((l) => l.costCodeId === costCodeId)) return prev;
      const option = budgetLines.find((b) => b.costCodeId === costCodeId);
      if (!option) return prev;
      const left = option.approved - option.allocated;
      return [
        ...prev,
        {
          key: nextKey++,
          // The category's own name, so the line is describable from the moment
          // it appears — an undescribed line is one the create step drops.
          item: option.name,
          costCodeId,
          quantity: "1",
          // What is actually left on the line. The ceiling, to be trimmed.
          unitPrice: left > 0 ? String(Math.round(left * 100) / 100) : "",
        },
      ];
    });
  }

  const scheduleSettings = schedule ?? DEFAULT_SCHEDULE;
  const [suggested] = useState<Record<ScheduleKey, string>>(
    () => suggestedDates ?? blankSchedule(),
  );
  const [dates, setDates] = useState<Record<ScheduleKey, string>>(suggested);
  function setDate(key: ScheduleKey, value: string) {
    setDates((prev) => ({ ...prev, [key]: value }));
  }

  /**
   * Only the lines that will actually be created.
   *
   * createCommonProject requires a description on every line, so a line priced
   * but left undescribed is dropped on submit. Totalling all of them promised a
   * budget the project would not get: $25,000 on the confirm step, $0.00 in the
   * database.
   */
  const namedLines = useMemo(() => lines.filter((l) => l.item.trim()), [lines]);
  const total = useMemo(() => namedLines.reduce((n, l) => n + lineTotal(l), 0), [namedLines]);

  // Money typed against a line with no description. Called out rather than
  // silently left out of the total — the number vanishing with no explanation is
  // how the mismatch stayed invisible.
  const strandedLines = lines.filter((l) => !l.item.trim() && lineTotal(l) > 0);

  /**
   * What each category this project touches would have left, once this
   * project's own lines are counted against it.
   *
   * Per category rather than per project, because a common-area job spends
   * across several. Exterior Paint's project-level code named $419k of a $530k
   * job and hid the rest on three other codes — the same shape of lie as a
   * typed budget, and the reason the question belongs here rather than up front.
   *
   * Shown, not enforced: spending past an underwritten allowance is a real
   * decision, and the app's job is to make sure it is made knowingly.
   */
  const byCategory = useMemo(() => {
    const spend = new Map<number, number>();
    for (const l of namedLines) spend.set(l.costCodeId, (spend.get(l.costCodeId) ?? 0) + lineTotal(l));
    return [...spend]
      .map(([id, amount]) => {
        const uw = budgetLines.find((b) => b.costCodeId === id);
        return {
          id,
          name: uw?.name ?? "Uncategorised",
          amount,
          remaining: uw ? uw.approved - uw.allocated - amount : null,
        };
      })
      .sort((a, b) => b.amount - a.amount);
  }, [namedLines, budgetLines]);

  function addLine() {
    // Defaults to whatever the last line used — consecutive lines usually sit
    // on the same category, and re-picking it every time is friction.
    const fallback = budgetLines[0]?.costCodeId;
    const previous = lines[lines.length - 1]?.costCodeId ?? fallback;
    if (previous == null) return;
    setLines((prev) => [...prev, blankLine(previous)]);
  }
  function patchLine(key: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function removeLine(key: number) {
    setLines((prev) => {
      const gone = prev.find((l) => l.key === key);
      const next = prev.filter((l) => l.key !== key);
      // Untick a category once nothing is left spending against it, so step one
      // cannot show a selection that step two has no line for.
      if (gone && !next.some((l) => l.costCodeId === gone.costCodeId)) {
        setCategories((cats) => {
          if (!cats.has(gone.costCodeId)) return cats;
          const out = new Set(cats);
          out.delete(gone.costCodeId);
          return out;
        });
      }
      return next;
    });
  }

  const canNext = (step === 0 && name.trim().length > 0) || step === 1 || step === 2;

  async function handleCreate() {
    setBusy(true);
    try {
      const result = await createCommonProject({
        propertyId,
        name: name.trim(),
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
              <p className="text-[11.5px] text-muted-foreground">What the work is called.</p>
            </div>

            {budgetLines.length === 0 ? (
              <p className="rounded-control bg-alert-bg px-2.5 py-1.5 text-[12px] text-alert">
                This property has no budget lines yet. Add one on the Budget tab first — scope with
                nothing to spend against cannot be reconciled later.
              </p>
            ) : (
              <div className="space-y-1.5">
                <Label>Which budget categories will it touch?</Label>
                <p className="text-[11.5px] text-muted-foreground">
                  Pick as many as apply — a common-area job usually spends across several. Each
                  becomes a scope line on the next step, prefilled with what is left on it, and you
                  set the real amounts there.
                </p>
                <BudgetCategoryPicker
                  options={budgetLines}
                  selected={categories}
                  onToggle={toggleCategory}
                />
              </div>
            )}

          </div>
        )}

        {/* Step 2 — the scope, which is also the budget */}
        {step === 1 && (
          <div className="space-y-3">
            <div className="space-y-1">
              <p className="text-[13px] leading-relaxed text-ink-600">
                What is being built. Each category you picked is here at the amount still
                available on it — trim each one to what this job will actually spend. The
                project&apos;s budget is what the lines add up to; there is no separate total to
                type.
              </p>
              <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                You can leave this empty and price it later; the project is created either way and
                shows as unpriced until somebody does.
              </p>
            </div>

            {lines.length > 0 && (
              <div className="divide-y divide-hairline rounded-card border border-border">
                {lines.map((l) => (
                  /* Two rows per line rather than one. The category select needs
                     real width to be readable, and squeezing six controls onto
                     one row at this card width made every one of them too narrow
                     to use. */
                  <div key={l.key} className="space-y-1.5 px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <Input
                        value={l.item}
                        placeholder="Replace perimeter fencing"
                        className="h-8 flex-1 text-[13px]"
                        onChange={(e) => patchLine(l.key, { item: e.target.value })}
                      />
                      <button
                        type="button"
                        aria-label="Remove line"
                        onClick={() => removeLine(l.key)}
                        className="shrink-0 text-ink-300 hover:text-alert"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        aria-label="Budget category"
                        value={l.costCodeId}
                        onChange={(e) => patchLine(l.key, { costCodeId: Number(e.target.value) })}
                        className="h-8 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 text-[12.5px] outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                      >
                        {budgetLines.map((b) => (
                          <option key={b.costCodeId} value={b.costCodeId}>
                            {b.name}
                          </option>
                        ))}
                      </select>
                      <Input
                        value={l.quantity}
                        type="number"
                        step="0.01"
                        aria-label="Quantity"
                        className="h-8 w-16 shrink-0 text-right text-[13px]"
                        onChange={(e) => patchLine(l.key, { quantity: e.target.value })}
                      />
                      <span className="shrink-0 text-[12px] text-ink-300">×</span>
                      <Input
                        value={l.unitPrice}
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        aria-label="Unit cost"
                        className="h-8 w-24 shrink-0 text-right text-[13px]"
                        onChange={(e) => patchLine(l.key, { unitPrice: e.target.value })}
                      />
                      <span className="w-24 shrink-0 text-right text-[13px] font-medium tabular-nums">
                        {l.unitPrice ? money(lineTotal(l)) : "—"}
                      </span>
                    </div>
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

            {strandedLines.length > 0 && (
              <p className="rounded-control bg-alert-bg px-2.5 py-1.5 text-[12px] text-alert">
                {strandedLines.length === 1 ? "A line has" : `${strandedLines.length} lines have`} a
                price but no description, so {strandedLines.length === 1 ? "it is" : "they are"} not
                counted above and will not be saved. Describe{" "}
                {strandedLines.length === 1 ? "it" : "them"} or remove{" "}
                {strandedLines.length === 1 ? "it" : "them"}.
              </p>
            )}

            {byCategory.length > 0 && (
              <div className="space-y-1 rounded-card border border-border px-3 py-2">
                <div className="text-[10.5px] font-semibold tracking-[0.09em] text-ink-300 uppercase">
                  Against the budget
                </div>
                {byCategory.map((c) => (
                  <div key={c.id} className="flex items-baseline justify-between text-[12px]">
                    <span className="truncate text-muted-foreground">{c.name}</span>
                    <span
                      className={cn(
                        "shrink-0 pl-3 tabular-nums",
                        c.remaining !== null && c.remaining < 0 ? "text-alert" : "text-ink-500",
                      )}
                    >
                      {money(c.amount)}
                      {c.remaining !== null && (
                        <span className="ml-1.5">
                          {c.remaining < 0
                            ? `· ${money(Math.abs(c.remaining))} over`
                            : `· ${money(c.remaining)} left`}
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
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
            <Summary
              label="Budget categories"
              value={byCategory.length > 0 ? byCategory.map((c) => c.name).join(", ") : "—"}
            />
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
            <Button onClick={handleCreate} disabled={busy || !name.trim()}>
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

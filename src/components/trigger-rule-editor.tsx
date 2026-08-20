"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDownIcon, ChevronUpIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  addTriggerCondition,
  addTriggerStep,
  moveTriggerStep,
  removeTriggerCondition,
  removeTriggerStep,
  updateTriggerStep,
} from "@/lib/actions/renovation-triggers";
import {
  TRIGGER_MODES,
  TRIGGER_MODE_LABELS,
  type TriggerMode,
  type TriggerStep,
} from "@/lib/renovation-triggers";

export type TypeOption = { id: number; name: string };

const selectClass =
  "h-8 rounded-control border border-input bg-transparent px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50";

/**
 * The pre-walk decision: ordered steps, first match wins.
 *
 * Order is the rule, not presentation, so the move controls are part of the
 * editor rather than a nicety — reordering two steps changes which renovation
 * type a unit is assigned.
 */
export function TriggerRuleEditor({
  propertyId,
  steps,
  types,
}: {
  propertyId: number;
  steps: TriggerStep[];
  types: TypeOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>, success?: string) {
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      if (success) toast.success(success);
      router.refresh();
    });
  }

  if (types.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-sm text-muted-foreground">
        This property has no renovation types yet — the rule has nothing to assign. Add a type
        first.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="px-4 text-sm text-muted-foreground">
        Steps run in order, and the first one whose condition is met assigns the renovation type.
        Answering these on a unit records why that unit got its type.
      </p>

      {steps.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">
          No steps yet. Add one for the type that needs the strongest justification — usually the
          most expensive — and leave the fallback for last.
        </p>
      ) : (
        <div className="space-y-2 px-4">
          {steps.map((step, i) => (
            <div key={step.id} className="rounded-card border border-border">
              <div className="flex flex-wrap items-center gap-2 border-b border-hairline bg-muted/30 px-3 py-2">
                <span className="flex size-5 items-center justify-center rounded-full bg-navy text-[11px] font-semibold text-white">
                  {i + 1}
                </span>

                <select
                  value={step.mode}
                  disabled={pending}
                  aria-label={`Step ${i + 1} condition mode`}
                  className={selectClass}
                  onChange={(e) =>
                    run(() =>
                      updateTriggerStep({
                        propertyId,
                        stepId: step.id,
                        mode: e.target.value as TriggerMode,
                      }),
                    )
                  }
                >
                  {TRIGGER_MODES.map((m) => (
                    <option key={m} value={m}>
                      {TRIGGER_MODE_LABELS[m]}
                    </option>
                  ))}
                </select>

                <span className="text-xs text-muted-foreground">then assign</span>

                <select
                  value={step.budgetGroupId}
                  disabled={pending}
                  aria-label={`Step ${i + 1} renovation type`}
                  className={selectClass}
                  onChange={(e) =>
                    run(() =>
                      updateTriggerStep({
                        propertyId,
                        stepId: step.id,
                        budgetGroupId: Number(e.target.value),
                      }),
                    )
                  }
                >
                  {/* An archived type still shows, so a rule pointing at one is
                      visible rather than silently snapping to another type. */}
                  {!types.some((t) => t.id === step.budgetGroupId) && (
                    <option value={step.budgetGroupId}>
                      {step.typeName ?? "Unavailable type"}
                    </option>
                  )}
                  {types.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>

                <span className="ml-auto flex items-center gap-1">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    disabled={pending || i === 0}
                    title="Move earlier"
                    onClick={() => run(() => moveTriggerStep({ propertyId, stepId: step.id, direction: "up" }))}
                  >
                    <ChevronUpIcon className="size-3.5" />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    disabled={pending || i === steps.length - 1}
                    title="Move later"
                    onClick={() => run(() => moveTriggerStep({ propertyId, stepId: step.id, direction: "down" }))}
                  >
                    <ChevronDownIcon className="size-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() =>
                      run(() => removeTriggerStep({ propertyId, stepId: step.id }), "Step removed")
                    }
                  >
                    Remove
                  </Button>
                </span>
              </div>

              <ul className="divide-y divide-hairline">
                {step.conditions.length === 0 ? (
                  <li className="px-3 py-2 text-[13px] text-ink-300">
                    No conditions — this step never fires until one is added.
                  </li>
                ) : (
                  step.conditions.map((c) => (
                    <li key={c.id} className="flex items-start gap-2 px-3 py-2">
                      <span className="flex-1 text-[13px] text-ink-700">{c.text}</span>
                      <button
                        type="button"
                        title="Remove this condition"
                        disabled={pending}
                        onClick={() =>
                          run(() => removeTriggerCondition({ propertyId, conditionId: c.id }))
                        }
                        className="mt-0.5 text-ink-100 hover:text-alert"
                      >
                        <XIcon className="size-3.5" />
                      </button>
                    </li>
                  ))
                )}
              </ul>

              <AddCondition
                pending={pending}
                onAdd={(text) =>
                  run(() => addTriggerCondition({ propertyId, stepId: step.id, text }))
                }
              />
            </div>
          ))}
        </div>
      )}

      <div className="px-4 pb-1">
        <AddStep propertyId={propertyId} types={types} pending={pending} onDone={run} />
      </div>
    </div>
  );
}

function AddCondition({
  pending,
  onAdd,
}: {
  pending: boolean;
  onAdd: (text: string) => void;
}) {
  return (
    <form
      className="flex flex-wrap items-center gap-2 border-t border-hairline px-3 py-2"
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const text = String(new FormData(form).get("text") ?? "").trim();
        if (!text) return;
        onAdd(text);
        form.reset();
      }}
    >
      <Input
        name="text"
        className="h-8 min-w-64 flex-1 text-xs"
        placeholder="e.g. Cabinet fronts require replacement"
      />
      <Button type="submit" size="sm" variant="ghost" disabled={pending}>
        + Add condition
      </Button>
    </form>
  );
}

function AddStep({
  propertyId,
  types,
  pending,
  onDone,
}: {
  propertyId: number;
  types: TypeOption[];
  pending: boolean;
  onDone: (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, success?: string) => void;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        + Add step
      </Button>
    );
  }

  return (
    <form
      className={cn("flex flex-wrap items-center gap-2 rounded-card border border-border p-3")}
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        setOpen(false);
        onDone(
          () =>
            addTriggerStep({
              propertyId,
              budgetGroupId: Number(fd.get("budgetGroupId")),
              mode: String(fd.get("mode")) as TriggerMode,
            }),
          "Step added",
        );
      }}
    >
      <select name="mode" defaultValue="any" className={selectClass} aria-label="Condition mode">
        {TRIGGER_MODES.map((m) => (
          <option key={m} value={m}>
            {TRIGGER_MODE_LABELS[m]}
          </option>
        ))}
      </select>
      <span className="text-xs text-muted-foreground">then assign</span>
      <select
        name="budgetGroupId"
        defaultValue={types[0]?.id}
        className={selectClass}
        aria-label="Renovation type"
      >
        {types.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      <Button type="submit" size="sm" disabled={pending}>
        Add step
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </form>
  );
}

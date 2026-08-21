"use client";

import { cn } from "@/lib/utils";
import {
  evaluateTriggers,
  TRIGGER_MODE_LABELS,
  type TriggerStep,
} from "@/lib/renovation-triggers";

/**
 * The pre-walk checklist, shown while picking a renovation type.
 *
 * A reminder, not a gate. It sits next to the type choice because that is the
 * moment the decision is made — the walker ticks what they found and the rule
 * says which type that points to, rather than the rule living on a settings page
 * nobody opens mid-walk.
 *
 * It does not change the selected type on its own. Ticking a box is an
 * observation about a unit; choosing what to spend on it is a decision, and
 * quietly switching the selection under someone would take that decision away.
 */
export function TriggerChecklist({
  steps,
  checked,
  onToggle,
  selectedTypeName,
}: {
  steps: TriggerStep[];
  checked: Set<number>;
  onToggle: (conditionId: number, next: boolean) => void;
  /** The type currently picked in the wizard, for the agree/disagree line. */
  selectedTypeName: string | null;
}) {
  const withConditions = steps.filter((s) => s.conditions.length > 0);
  if (withConditions.length === 0) return null;

  const suggestion = evaluateTriggers(steps, checked);
  const anyChecked = checked.size > 0;
  const agrees =
    suggestion != null && selectedTypeName != null && suggestion.typeName === selectedTypeName;

  return (
    <div className="space-y-2 rounded-card border border-border bg-muted/20 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-ink-300">
          Pre-walk checklist
        </span>
        <span className="text-[11px] text-muted-foreground">
          What did the walker find? Ticking these does not change your choice.
        </span>
      </div>

      <div className="space-y-2">
        {withConditions.map((step, i) => (
          <div key={step.id} className="space-y-1">
            <div className="text-[11px] text-ink-400">
              {i + 1} · {TRIGGER_MODE_LABELS[step.mode]} → {step.typeName ?? "unavailable type"}
            </div>
            {step.conditions.map((c) => (
              <label
                key={c.id}
                className="flex cursor-pointer items-start gap-2 text-[13px] text-ink-700"
              >
                <input
                  type="checkbox"
                  checked={checked.has(c.id)}
                  onChange={(e) => onToggle(c.id, e.target.checked)}
                  className="mt-0.5 size-3.5 accent-navy"
                />
                <span>{c.text}</span>
              </label>
            ))}
          </div>
        ))}
      </div>

      {anyChecked && (
        <p
          className={cn(
            "rounded-control px-2.5 py-1.5 text-[12px]",
            // Only flag a real disagreement. No match at all is normal — the
            // fallback type is usually the one with no conditions.
            suggestion && selectedTypeName && !agrees
              ? "bg-alert-bg text-alert"
              : "bg-card text-ink-500",
          )}
        >
          {suggestion
            ? agrees
              ? `These findings point to ${suggestion.typeName}, which is what you have selected.`
              : `These findings point to ${suggestion.typeName ?? "an unavailable type"}${
                  selectedTypeName ? `, not ${selectedTypeName}` : ""
                }. Either is allowed — the rule is a guide.`
            : "These findings don't fire any step, so no type is indicated."}
        </p>
      )}
    </div>
  );
}

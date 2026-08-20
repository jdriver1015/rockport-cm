"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { recordTriggerAnswers } from "@/lib/actions/renovation-triggers";
import {
  evaluateTriggers,
  TRIGGER_MODE_LABELS,
  type TriggerAnswer,
  type TriggerStep,
} from "@/lib/renovation-triggers";

/**
 * "Why Signature?" for one unit — the pre-walk answers that justify the
 * renovation type it was assigned.
 *
 * Reads the recorded wording, not the live rule: the rule gets edited, and the
 * point of this panel is what was actually asked and answered at the time.
 */
export function TriggerAnswersPanel({
  projectId,
  propertyId,
  steps,
  answers,
  assignedTypeName,
}: {
  projectId: number;
  propertyId: number;
  steps: TriggerStep[];
  answers: TriggerAnswer[];
  assignedTypeName: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);

  const allConditions = steps.flatMap((s) => s.conditions);
  const [checked, setChecked] = useState<Set<number>>(
    () =>
      new Set(
        answers
          .filter((a) => a.checked && a.conditionId != null)
          .map((a) => a.conditionId as number),
      ),
  );

  const recorded = answers.length > 0;
  const recordedAt = recorded
    ? answers.reduce((latest, a) => (a.recordedAt > latest ? a.recordedAt : latest), answers[0].recordedAt)
    : null;
  const recordedBy = answers.find((a) => a.recordedByName)?.recordedByName ?? null;

  const suggestion = evaluateTriggers(steps, checked);

  function save() {
    startTransition(async () => {
      const res = await recordTriggerAnswers({
        projectId,
        propertyId,
        checkedConditionIds: [...checked],
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setEditing(false);
      toast.success(`Recorded ${res.recorded} answer(s)`);
      router.refresh();
    });
  }

  if (allConditions.length === 0 && !recorded) {
    return (
      <p className="text-[13px] text-muted-foreground">
        No trigger rule set up for this property yet.
      </p>
    );
  }

  if (!editing) {
    return (
      <div className="space-y-2">
        {recorded ? (
          <>
            <ul className="space-y-1">
              {answers.map((a, i) => (
                <li key={i} className="flex items-start gap-2 text-[13px]">
                  <span
                    className={cn(
                      "mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-sm border",
                      a.checked ? "border-positive bg-positive-bg text-positive" : "border-ink-100",
                    )}
                  >
                    {a.checked && <CheckIcon className="size-2.5" />}
                  </span>
                  <span className={a.checked ? "text-ink-700" : "text-ink-300"}>
                    {a.conditionText}
                    {a.conditionId == null && (
                      <span className="ml-1.5 text-[10.5px] uppercase tracking-[0.09em] text-ink-200">
                        no longer in the rule
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-muted-foreground">
              Recorded at pre-walk
              {recordedBy ? ` by ${recordedBy}` : ""}
              {recordedAt ? ` · ${fmtDate(recordedAt)}` : ""}
            </p>
          </>
        ) : (
          <p className="text-[13px] text-muted-foreground">
            Nothing recorded for this unit yet — the reason it got
            {assignedTypeName ? ` ${assignedTypeName}` : " its type"} isn&apos;t written down.
          </p>
        )}
        {allConditions.length > 0 && (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            {recorded ? "Re-record answers" : "Record answers"}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {steps.map((step, i) => (
        <div key={step.id} className="space-y-1">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-ink-300">
            {i + 1} · {TRIGGER_MODE_LABELS[step.mode]} → {step.typeName ?? "unavailable type"}
          </div>
          {step.conditions.length === 0 ? (
            <p className="text-[13px] text-ink-300">No conditions on this step.</p>
          ) : (
            step.conditions.map((c) => (
              <label key={c.id} className="flex cursor-pointer items-start gap-2 text-[13px]">
                <input
                  type="checkbox"
                  checked={checked.has(c.id)}
                  disabled={pending}
                  onChange={(e) =>
                    setChecked((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(c.id);
                      else next.delete(c.id);
                      return next;
                    })
                  }
                  className="mt-0.5 size-3.5 accent-navy"
                />
                <span>{c.text}</span>
              </label>
            ))
          )}
        </div>
      ))}

      {/* A preview, not an assignment: the rule says which type these answers
          point to, but changing a unit's type is its own decision and its own
          action. Saying so beats silently doing neither. */}
      <p className="rounded-control bg-muted/40 px-2.5 py-1.5 text-[12px] text-ink-500">
        {suggestion
          ? `These answers point to ${suggestion.typeName ?? "an unavailable type"}.`
          : "These answers don't fire any step."}
        {assignedTypeName ? ` This unit is currently ${assignedTypeName}.` : ""} Recording answers
        does not change the unit&apos;s type.
      </p>

      <div className="flex items-center gap-2">
        <Button size="sm" disabled={pending} onClick={save}>
          {pending ? "Saving…" : "Save answers"}
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

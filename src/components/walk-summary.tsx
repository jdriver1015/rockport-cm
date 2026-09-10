"use client";

import { useEffect, useRef, useState } from "react";
import { CheckIcon } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { updateAudit } from "@/lib/actions/audits";

/**
 * The walk's narrative.
 *
 * Autosaved, because the alternative on a phone is a Save button somebody
 * forgets while a call comes in. Debounced rather than saved per keystroke —
 * a superintendent typing a paragraph should cost one write, not two hundred.
 *
 * Nothing here blocks: a failed save leaves the text on screen and says so,
 * and the next keystroke tries again. Losing a paragraph typed in a stairwell
 * is the one outcome worth engineering against.
 */
export function WalkSummary({
  auditId,
  propertyId,
  initialNotes,
  canEdit,
}: {
  auditId: number;
  propertyId: number;
  initialNotes: string | null;
  canEdit: boolean;
}) {
  const [value, setValue] = useState(initialNotes ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // What the server is known to hold, so an unchanged blur does not write.
  const savedValue = useRef(initialNotes ?? "");

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  function schedule(next: string) {
    setValue(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      if (next === savedValue.current) return;
      setState("saving");
      const res = await updateAudit({ id: auditId, propertyId, notes: next });
      if (res.ok) {
        savedValue.current = next;
        setState("saved");
      } else {
        setState("error");
      }
    }, 900);
  }

  if (!canEdit) {
    return value ? (
      <p className="text-sm whitespace-pre-wrap text-ink-500">{value}</p>
    ) : (
      <p className="text-sm text-muted-foreground">No summary written.</p>
    );
  }

  return (
    <div className="space-y-1.5">
      <Textarea
        value={value}
        onChange={(e) => schedule(e.target.value)}
        rows={4}
        placeholder="What did you see? Weather, crews on site, what got done, anything worth remembering."
        className="min-h-[110px] text-[15px]"
      />
      <div className="flex h-4 items-center justify-end text-[11px]" aria-live="polite">
        {state === "saving" && <span className="text-muted-foreground">Saving…</span>}
        {state === "saved" && (
          <span className="flex items-center gap-1 text-positive">
            <CheckIcon className="size-3" />
            Saved
          </span>
        )}
        {state === "error" && (
          <span className="text-alert">Couldn&rsquo;t save — keep typing to retry</span>
        )}
      </div>
    </div>
  );
}

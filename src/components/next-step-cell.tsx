"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { setProjectPhase } from "@/lib/actions/projects";
import type { NextStep } from "@/lib/phase-gates";

/**
 * The one thing to do next on a project, as a control.
 *
 * Only `advance` is a filled button, and that is the whole point of the column:
 * it is the only step that finishes from the row without going anywhere, so
 * scanning down for the dark buttons is scanning for what can be cleared right
 * now. Everything else takes you to where the work happens and reads as a quiet
 * outline, in the order pre-con actually runs.
 *
 * The advance is not disabled when gates are outstanding, because it is never
 * offered then — `nextStep` returns the blocking gate instead. And it is not
 * trusted either: setProjectPhase runs checkPhaseAdvance server-side, so a stale
 * page cannot push a project through a gate that has since closed.
 */
export function NextStepCell({
  projectId,
  projectHref,
  propertySlug,
  step,
}: {
  projectId: number;
  /** /properties/{slug}/projects/{id-name} — where the work lives. */
  projectHref: string;
  propertySlug: string;
  step: NextStep;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (step.kind === "none") {
    return <span className="block text-[13px] font-semibold text-ink-100">—</span>;
  }

  if (step.kind === "advance") {
    return (
      <Button
        size="sm"
        disabled={pending}
        onClick={() => {
          const fd = new FormData();
          fd.set("projectId", String(projectId));
          fd.set("toPhase", step.toPhase);
          startTransition(async () => {
            const result = await setProjectPhase(fd);
            if (!result.ok) {
              // The gates closed since this page rendered. The server's message
              // names which one, so it is worth showing verbatim.
              toast.error(result.error);
              return;
            }
            toast.success(step.label.replace(/^Advance to/, "Advanced to"));
            router.refresh();
          });
        }}
        className="max-w-full"
      >
        <span className="truncate">{pending ? "Advancing…" : step.label}</span>
      </Button>
    );
  }

  // The audits target goes to the audit holding the findings, not to the
  // project page: findings are not on either project panel — they live behind
  // the header's manage menu — so "Resolve 2 findings" used to land somewhere
  // that showed none. Falls back to the property's audit list if the id is
  // missing, which still shows findings.
  const href =
    step.target === "gl"
      ? `/properties/${propertySlug}/gl`
      : step.target === "audits"
        ? step.auditId != null
          ? `/properties/${propertySlug}/audits/${step.auditId}`
          : `/properties/${propertySlug}/audits`
        : `${projectHref}?tab=workflow${step.gate ? `&gate=${step.gate}` : ""}`;

  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <Button
        size="sm"
        // A gate has a dialog waiting on the other side; the rest are a trip to
        // another screen. Outline against ghost is the difference between them.
        variant={step.gate ? "outline" : "ghost"}
        render={<Link href={href} />}
        nativeButton={false}
        className="min-w-0"
      >
        <span className="truncate">{step.label}</span>
        <ChevronRightIcon data-icon="inline-end" className="opacity-75" />
      </Button>
      {/* The only number in this row that is somebody else's fault — both gates
          that can show it are waiting on a vendor. Same five-day threshold the
          project page's gate list uses. */}
      {step.waitingDays != null && (
        <span
          className={cn(
            "shrink-0 rounded-control px-1.5 py-0.5 text-[11px] tabular-nums",
            step.waitingDays >= 5 ? "bg-alert/10 text-alert" : "bg-track text-muted-foreground",
          )}
          title={`Waiting ${step.waitingDays} day${step.waitingDays === 1 ? "" : "s"} on the vendor`}
        >
          {step.waitingDays}d
        </span>
      )}
    </span>
  );
}

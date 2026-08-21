"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2Icon, CircleIcon, EllipsisIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { fmtDate } from "@/lib/format";
import { toIsoDate, todayInBusinessZone } from "@/lib/schedule-defaults";
import { createMilestone, updateMilestone, archiveMilestone } from "@/lib/actions/milestones";
import type { GateResult, PreconGateKey } from "@/lib/phase-gates";
import { phaseIndex, prevPhase } from "@/lib/stages";
import { setProjectPhase } from "@/lib/actions/projects";
import { PreWalkDialog } from "@/components/pre-walk-dialog";
import { DefineScopeDialog, type PreWalkFinding } from "@/components/define-scope-dialog";
import { SelectBidDialog } from "@/components/select-bid-dialog";
import type { BidPackageOption } from "@/lib/bid-package";

/** What the pre-con gate dialogs need to resolve their gate. */
export type GateContext = {
  propertyId: number;
  propertySlug: string;
  scopeLineCount: number;
  preWalkFindings: PreWalkFinding[];
  bidPackage: BidPackageOption;
  preWalkDate: string | null;
  preWalkTime: string | null;
  preWalkAuditId: number | null;
  preWalkAuditStatus: "draft" | "complete" | null;
};

export type PhaseRow = {
  id: number;
  label: string;
  /** Which phase this row records. Null on a custom row. */
  phase: string | null;
  plannedDate: string | null;
  actualDate: string | null;
  note: string | null;
  /** One of the four seeded phase rows — label follows the phase, cannot be deleted. */
  isDefault: boolean;
};

/** The one grid the header and every row share, so columns line up. */
const GRID = "grid grid-cols-[minmax(170px,1fr)_112px_112px_84px_auto] items-center gap-3";

function varianceDays(planned: string | null, actual: string | null): number | null {
  if (!planned || !actual) return null;
  const p = new Date(`${planned}T00:00:00`).getTime();
  const a = new Date(`${actual}T00:00:00`).getTime();
  if (Number.isNaN(p) || Number.isNaN(a)) return null;
  return Math.round((a - p) / 86_400_000);
}

/**
 * Today in the business timezone.
 *
 * The table this replaces used `new Date().toISOString().slice(0, 10)`, which is
 * UTC — after 7pm Central it stamped a completion with tomorrow's date.
 */
function today(): string {
  return toIsoDate(todayInBusinessZone());
}

/**
 * The project's phases: planned against actual, with the current one raised out
 * of the list and carrying what has to happen before it can be left.
 *
 * The four seeded rows ARE the phases — same names, one vocabulary — so this is
 * one table rather than a phase widget and a milestone table restating each
 * other. Custom rows share the list; they carry no phase, so they never become
 * the current row.
 */
export function ProjectPhases({
  projectId,
  phases,
  currentPhase,
  gate,
  gateContext,
  nextPhaseLabel,
}: {
  projectId: number;
  phases: PhaseRow[];
  /** The phase the project is actually in — projects.phase. */
  currentPhase: string;
  /** Everything the gate dialogs need. Absent for a project with no gates. */
  gateContext?: GateContext;
  /**
   * Gate checks for leaving the current phase. Null when the project is in its
   * last phase, or when the transition has no checks defined.
   */
  gate: GateResult | null;
  nextPhaseLabel: string | null;
}) {
  const [drafts, setDrafts] = useState<{ key: string; createdId: number | null }[]>([]);
  const visibleDrafts = drafts.filter(
    (d) => d.createdId == null || !phases.some((p) => p.id === d.createdId),
  );

  const defaults = phases.filter((p) => p.isDefault);
  // The current phase is the one the PROJECT says it is in, not the first row
  // without an actual date. Those disagree constantly: the Pre-Construction row
  // is stamped by hand so it is usually blank, and rows get completed out of
  // order — deriving from dates put 26 of 28 live projects on the wrong row.
  const currentIndex = defaults.findIndex((p) => p.phase === currentPhase);
  // A phase the project has not reached cannot have happened, so its actual date
  // is read-only. Hiding Mark complete but leaving the Actual cell editable would
  // have been the same hole by another route. Past and current stay editable —
  // recording and correcting history is the point of the column.
  const reached = (row: PhaseRow) =>
    row.phase == null || phaseIndex(row.phase) <= phaseIndex(currentPhase);
  const current = currentIndex === -1 ? null : defaults[currentIndex];
  const doneCount = defaults.filter((p) => p.actualDate).length;
  const rest = phases.filter((p) => p.id !== current?.id);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
        <span className="text-sm text-muted-foreground">
          {current
            ? `Phase ${currentIndex + 1} of ${defaults.length}`
            : `${defaults.length} phases`}
          {current?.plannedDate ? ` · planned ${fmtDate(current.plannedDate)}` : ""}
        </span>
        <span className="text-sm tabular-nums text-muted-foreground">
          {doneCount} of {defaults.length} met
        </span>
      </div>

      <div
        className={cn(
          GRID,
          "border-b border-border px-3 pb-2 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-ink-300",
        )}
      >
        <div>Phase</div>
        <div className="text-right">Planned</div>
        <div className="text-right">Actual</div>
        <div className="text-right">Var</div>
        <div className="text-right">Actions</div>
      </div>

      {current && (
        <div className="rounded-card border border-border bg-card shadow-card">
          <div className={cn(GRID, "px-3 py-4")}>
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-gold-ink">
                Current phase
              </div>
              <div className="mt-1 truncate text-base font-semibold text-navy">{current.label}</div>
              {current.note && (
                <div className="mt-0.5 truncate text-xs text-muted-foreground">{current.note}</div>
              )}
            </div>
            <PhaseDates phase={current} canEditActual emphasise />
            <PhaseActions phase={current} projectId={projectId} isCurrent />
          </div>

          {gate && gate.checks.length > 0 && (
            <GateRow gate={gate} nextPhaseLabel={nextPhaseLabel} projectId={projectId} context={gateContext} />
          )}
        </div>
      )}

      <div className="divide-y divide-hairline border-y border-border">
        {rest.length === 0 && visibleDrafts.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No other phases.</p>
        ) : (
          rest.map((p) => (
            <div key={p.id} className={cn(GRID, "px-3 py-3")}>
              <PhaseName phase={p} />
              <PhaseDates phase={p} canEditActual={reached(p)} />
              <PhaseActions phase={p} projectId={projectId} isCurrent={false} />
            </div>
          ))
        )}
        {visibleDrafts.map((d) => (
          <div key={d.key} className="px-3 py-3">
            <DraftPhase
              projectId={projectId}
              onCreated={(id) =>
                setDrafts((ds) => ds.map((x) => (x.key === d.key ? { ...x, createdId: id } : x)))
              }
              onCancel={() => setDrafts((ds) => ds.filter((x) => x.key !== d.key))}
            />
          </div>
        ))}
      </div>

      <div className="px-1">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setDrafts((ds) => [...ds, { key: crypto.randomUUID(), createdId: null }])}
        >
          + Add phase
        </Button>
      </div>
    </div>
  );
}

/** Planned, actual and the variance between them — both dates editable in place. */
function PhaseDates({
  phase,
  canEditActual,
  emphasise,
}: {
  phase: PhaseRow;
  /** False on a phase the project has not reached. */
  canEditActual: boolean;
  emphasise?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [planned, setPlanned] = useState(phase.plannedDate ?? "");
  const [actual, setActual] = useState(phase.actualDate ?? "");
  const [editing, setEditing] = useState<"planned" | "actual" | null>(null);

  function save(patch: { plannedDate?: string; actualDate?: string }) {
    setEditing(null);
    startTransition(async () => {
      const res = await updateMilestone({ id: phase.id, ...patch });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      router.refresh();
    });
  }

  const variance = varianceDays(planned || null, actual || null);
  const size = emphasise ? "text-sm" : "text-[13px]";

  return (
    <>
      <div className="text-right">
        {editing === "planned" ? (
          <Input
            autoFocus
            type="date"
            className="h-8 text-right text-xs"
            value={planned}
            disabled={pending}
            onChange={(e) => setPlanned(e.target.value)}
            onBlur={() => save({ plannedDate: planned })}
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditing("planned")}
            className={cn("tabular-nums", size, planned ? "text-ink-700" : "text-ink-300 hover:text-link")}
          >
            {planned ? fmtDate(planned) : "Set date"}
          </button>
        )}
      </div>

      <div className="text-right">
        {!canEditActual ? (
          <span className="text-[13px] text-ink-200" title="Not reached yet">
            —
          </span>
        ) : editing === "actual" ? (
          <Input
            autoFocus
            type="date"
            className="h-8 text-right text-xs"
            value={actual}
            disabled={pending}
            onChange={(e) => setActual(e.target.value)}
            onBlur={() => save({ actualDate: actual })}
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditing("actual")}
            className={cn(
              "tabular-nums",
              size,
              actual ? "font-semibold text-navy" : "text-ink-300 hover:text-link",
            )}
          >
            {actual ? fmtDate(actual) : "—"}
          </button>
        )}
      </div>

      <div className="text-right">
        {variance == null ? (
          <span className="text-[13px] text-ink-200">—</span>
        ) : (
          <span
            className={cn(
              "inline-block rounded px-1.5 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.09em]",
              variance > 0 ? "bg-alert/10 text-alert" : "bg-positive/10 text-positive",
            )}
          >
            {variance === 0 ? "on plan" : variance > 0 ? `+${variance}d` : `${variance}d`}
          </span>
        )}
      </div>
    </>
  );
}

function PhaseName({ phase }: { phase: PhaseRow }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [label, setLabel] = useState(phase.label);
  const [editing, setEditing] = useState(false);

  if (editing && !phase.isDefault) {
    return (
      <Input
        autoFocus
        className="h-8 text-xs"
        value={label}
        disabled={pending}
        onChange={(e) => setLabel(e.target.value)}
        onBlur={() => {
          setEditing(false);
          if (label.trim() === phase.label) return;
          startTransition(async () => {
            const res = await updateMilestone({ id: phase.id, label });
            if (!res.ok) {
              toast.error(res.error);
              return;
            }
            router.refresh();
          });
        }}
      />
    );
  }

  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => !phase.isDefault && setEditing(true)}
        className={cn(
          "flex w-full items-center gap-2 truncate text-left text-[13.5px]",
          phase.actualDate ? "text-ink-500" : "text-ink-700",
          phase.isDefault ? "cursor-default" : "hover:text-link",
        )}
      >
        {phase.actualDate ? (
          <CheckCircle2Icon className="size-3.5 shrink-0 text-positive" />
        ) : (
          <CircleIcon className="size-3.5 shrink-0 text-ink-100" />
        )}
        <span className="truncate">{phase.label}</span>
      </button>
      {phase.note && <div className="mt-0.5 truncate pl-5 text-xs text-muted-foreground">{phase.note}</div>}
    </div>
  );
}

/**
 * Mark complete, plus the overflow: notes, clearing the date, reopening the
 * previous phase, deleting a custom phase.
 *
 * Only the phase the project is actually in can be marked complete. Letting any
 * row be ticked meant a project sitting in Pre-Construction could have Punch
 * signed off, which the variance column would then report against a phase the
 * work had not reached.
 */
function PhaseActions({
  phase,
  projectId,
  isCurrent,
}: {
  phase: PhaseRow;
  projectId: number;
  isCurrent: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState(phase.note ?? "");
  const done = !!phase.actualDate;
  // Only offered on the current row: going back from a row the project has not
  // reached would mean nothing.
  const back = isCurrent && phase.phase ? prevPhase(phase.phase) : null;

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

  return (
    <div className="flex items-center justify-end gap-1.5">
      {noteOpen ? (
        <Input
          autoFocus
          className="h-8 max-w-56 text-xs"
          value={note}
          placeholder="What happened?"
          disabled={pending}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => {
            setNoteOpen(false);
            if (note === (phase.note ?? "")) return;
            run(() => updateMilestone({ id: phase.id, note }));
          }}
        />
      ) : (
        isCurrent &&
        !done && (
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() =>
              run(
                () => updateMilestone({ id: phase.id, actualDate: today() }),
                `${phase.label} marked complete`,
              )
            }
          >
            <CheckCircle2Icon className="size-3.5" />
            Mark complete
          </Button>
        )
      )}

      <DropdownMenu>
        <DropdownMenuTrigger disabled={pending} render={<Button variant="ghost" size="icon-sm" />}>
          <EllipsisIcon />
          <span className="sr-only">{phase.label} actions</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {back && (
            <DropdownMenuItem
              onClick={() =>
                run(() => {
                  // Reuses setProjectPhase so the move keeps the activity-log
                  // entry, the stage event and the date side effects that any
                  // other phase change gets. Backwards moves are never gated.
                  const fd = new FormData();
                  fd.set("projectId", String(projectId));
                  fd.set("toPhase", back.key);
                  return setProjectPhase(fd);
                }, `Reopened ${back.label}`)
              }
            >
              Reopen {back.label}
            </DropdownMenuItem>
          )}
          {done && (
            <DropdownMenuItem onClick={() => run(() => updateMilestone({ id: phase.id, actualDate: "" }))}>
              Clear actual date
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => setNoteOpen(true)}>
            {phase.note ? "Edit note" : "Add note"}
          </DropdownMenuItem>
          {!phase.isDefault && (
            <DropdownMenuItem
              variant="destructive"
              onClick={() => run(() => archiveMilestone({ id: phase.id }), "Phase removed")}
            >
              Delete phase
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/**
 * What has to be true before this phase can be left.
 *
 * These are the checks src/lib/phase-gates.ts already defines — every one
 * derived from state the project holds, so a check cannot claim outstanding
 * while the thing it describes is done. They were only reachable from a dialog
 * nothing mounted; the point of showing them here is that the requirement is
 * visible before someone tries to advance, not after.
 */
function GateRow({
  gate,
  nextPhaseLabel,
  projectId,
  context,
}: {
  gate: GateResult;
  nextPhaseLabel: string | null;
  projectId: number;
  context?: GateContext;
}) {
  const [openGate, setOpenGate] = useState<PreconGateKey | null>(null);
  const outstanding = gate.checks.length - gate.metCount;

  return (
    <div className="grid grid-cols-[minmax(170px,1fr)_auto] items-start gap-3 border-t border-hairline px-3 py-3.5">
      <div className="text-[10px] font-semibold uppercase tracking-[0.09em] text-ink-300">
        Action items
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {gate.checks.map((check) => {
          const body = (
            <>
              {check.met ? (
                <CheckCircle2Icon className="size-3.5" />
              ) : (
                <CircleIcon className="size-3.5" />
              )}
              {check.label}
              <span className={cn("font-normal", check.met ? "text-positive/80" : "text-ink-300")}>
                · {check.detail}
              </span>
            </>
          );
          const shape = cn(
            "inline-flex items-center gap-1.5 rounded-control border px-2.5 py-1.5 text-[12.5px] font-medium",
            check.met
              ? "border-positive/30 bg-positive-bg text-positive"
              : "border-dashed border-border text-ink-400",
          );
          // A gate with something behind it is a button; a met gate stays a
          // button too, because you still open it to see or change what met it.
          if (check.key && context) {
            return (
              <button
                key={check.label}
                type="button"
                title={check.detail}
                onClick={() => setOpenGate(check.key!)}
                className={cn(shape, "transition-colors hover:border-solid hover:bg-track")}
              >
                {body}
              </button>
            );
          }
          return (
            <span key={check.label} title={check.detail} className={shape}>
              {body}
            </span>
          );
        })}
        <span className="ml-1 text-[12px] text-muted-foreground">
          {outstanding === 0
            ? `all met — ready for ${nextPhaseLabel ?? "the next phase"}`
            : `all ${gate.checks.length} required to advance${nextPhaseLabel ? ` to ${nextPhaseLabel}` : ""}`}
        </span>
      </div>

      {context && (
        <SelectBidDialog
          open={openGate === "bid"}
          onOpenChange={(o) => !o && setOpenGate(null)}
          projectId={projectId}
          data={context.bidPackage}
        />
      )}

      {context && (
        <DefineScopeDialog
          open={openGate === "scope"}
          onOpenChange={(o) => !o && setOpenGate(null)}
          propertyId={context.propertyId}
          projectId={projectId}
          scopeLineCount={context.scopeLineCount}
          findings={context.preWalkFindings}
          hasPreWalk={context.preWalkAuditStatus != null}
        />
      )}

      {context && (
        <PreWalkDialog
          open={openGate === "pre_walk"}
          onOpenChange={(o) => !o && setOpenGate(null)}
          projectId={projectId}
          propertySlug={context.propertySlug}
          preWalkDate={context.preWalkDate}
          preWalkTime={context.preWalkTime}
          auditId={context.preWalkAuditId}
          auditStatus={context.preWalkAuditStatus}
        />
      )}
    </div>
  );
}

function DraftPhase({
  projectId,
  onCreated,
  onCancel,
}: {
  projectId: number;
  onCreated: (id: number) => void;
  onCancel: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [label, setLabel] = useState("");
  const [planned, setPlanned] = useState("");

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!label.trim()) return;
        startTransition(async () => {
          const res = await createMilestone({
            projectId,
            label,
            plannedDate: planned || null,
            actualDate: null,
            note: null,
          });
          if (!res.ok) {
            toast.error(res.error);
            return;
          }
          onCreated(res.id);
          router.refresh();
        });
      }}
    >
      <Input
        autoFocus
        className="h-8 max-w-56 text-xs"
        placeholder="Phase name"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
      />
      <Input
        type="date"
        className="h-8 w-40 text-xs"
        value={planned}
        onChange={(e) => setPlanned(e.target.value)}
      />
      <Button type="submit" size="sm" disabled={pending || !label.trim()}>
        Add
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </form>
  );
}

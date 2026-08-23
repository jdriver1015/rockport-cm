"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertCircleIcon, CheckCircle2Icon, ChevronRightIcon, CircleIcon, EllipsisIcon } from "lucide-react";
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
import { updateMilestone, archiveMilestone } from "@/lib/actions/milestones";
import type { GateResult, PreconGateKey } from "@/lib/phase-gates";
import { phaseIndex, prevPhase } from "@/lib/stages";
import { setProjectPhase } from "@/lib/actions/projects";
import { PreWalkDialog } from "@/components/pre-walk-dialog";
import {
  DefineScopeDialog,
  type PreWalkFinding,
  type ScopeLine,
} from "@/components/define-scope-dialog";
import { SelectBidDialog } from "@/components/select-bid-dialog";
import { ContractDialog, type ContractView } from "@/components/contract-dialog";
import type { BidPackageOption } from "@/lib/bid-package";

/** What the pre-con gate dialogs need to resolve their gate. */
export type GateContext = {
  propertyId: number;
  propertySlug: string;
  scopeLineCount: number;
  scopeLines: ScopeLine[];
  scopeConfirmedAt: string | null;
  /** True once an RFP is out — the scope's priced fields are frozen. */
  scopeLocked: boolean;
  preWalkFindings: PreWalkFinding[];
  bidPackage: BidPackageOption;
  preWalkDate: string | null;
  preWalkTime: string | null;
  preWalkAuditId: number | null;
  preWalkAuditStatus: "draft" | "complete" | null;
  /** The live contract, if one has been generated. */
  contract: ContractView | null;
  /** The awarded bid, for the contract dialog to confirm. */
  award: { vendorName: string | null; total: number } | null;
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
const GRID = "grid grid-cols-[minmax(150px,1fr)_112px_112px_84px_auto] items-center gap-3";

/** The rail the step markers sit on, and the gutter between it and the row. */
const RAIL = "flex w-5 shrink-0 flex-col items-center";

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
  // Always phase order, never the order the rows came back in and never with the
  // current one lifted to the top. A project in Complete showed Complete above
  // Pre-Construction, which reads as the sequence rather than as emphasis.
  // Anything custom trails the four, since it has no place in the sequence.
  const LAST = Number.MAX_SAFE_INTEGER;
  const ordered = [...phases].sort(
    (a, b) =>
      (a.phase ? phaseIndex(a.phase) : LAST) - (b.phase ? phaseIndex(b.phase) : LAST) ||
      a.id - b.id,
  );

  return (
    <div className="space-y-3">
      <div className="flex gap-3">
        <div className="w-5 shrink-0" aria-hidden />
        <div
          className={cn(
            GRID,
            "flex-1 border-b border-border px-1 pb-2 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-ink-300",
          )}
        >
          <div>Phase</div>
          <div className="text-right">Planned</div>
          <div className="text-right">Actual</div>
          <div className="text-right">Var</div>
          <div className="text-right">Actions</div>
        </div>
      </div>

      {/*
        A rail with a marker per phase, rather than four equal table rows. The
        phase you are in is the only one that expands, so the ones you are not
        in cost a line each instead of a row of empty cells — and pre-con, which
        carries most of the work, gets the room its five gates need.
      */}
      <div>
        {ordered.map((row, i) => {
          const isCurrent = row.id === current?.id;
          const done = !!row.actualDate;
          const last = i === ordered.length - 1;
          // Reached but never stamped. Worth showing as a warning rather than
          // as an empty cell: it means the project moved past a phase without
          // anyone recording when, and the variance column silently gives up.
          const skipped = !isCurrent && !done && reached(row);

          return (
            <div key={row.id} className="flex gap-3">
              <div className={RAIL}>
                {done ? (
                  <CheckCircle2Icon className="size-[18px] shrink-0 text-positive" />
                ) : isCurrent ? (
                  <span className="flex size-[18px] shrink-0 items-center justify-center">
                    <span className="size-2.5 rounded-full bg-navy" />
                  </span>
                ) : skipped ? (
                  <AlertCircleIcon className="size-[18px] shrink-0 text-alert/70" />
                ) : (
                  <CircleIcon className="size-[18px] shrink-0 text-ink-100" />
                )}
                {!last && (
                  <div
                    className={cn("w-px flex-1", done ? "bg-positive/30" : "bg-border")}
                    aria-hidden
                  />
                )}
              </div>

              <div className={cn("min-w-0 flex-1", last ? "pb-0" : "pb-3")}>
                <div className={cn(GRID, "px-1")}>
                  {isCurrent ? (
                    <div className="min-w-0">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-400">
                        Current phase
                      </div>
                      <div className="mt-0.5 truncate text-[17px] font-semibold text-navy">
                        {row.label}
                      </div>
                      {row.note && (
                        <div className="mt-0.5 truncate text-xs text-muted-foreground">
                          {row.note}
                        </div>
                      )}
                    </div>
                  ) : (
                    <PhaseName phase={row} hideIcon />
                  )}
                  <PhaseDates phase={row} canEditActual={reached(row)} emphasise={isCurrent} />
                  <PhaseActions
                    phase={row}
                    projectId={projectId}
                    isCurrent={isCurrent}
                    advance={
                      isCurrent && gate && nextPhaseLabel
                        ? {
                            key: gate.toPhase,
                            label: nextPhaseLabel,
                            allMet: gate.allMet,
                            outstanding: gate.checks.length - gate.metCount,
                          }
                        : undefined
                    }
                  />
                </div>

                {skipped && (
                  <div className="px-1 pt-0.5 text-[11.5px] text-alert/80">
                    Passed through with no date recorded
                  </div>
                )}

                {isCurrent && gate && gate.checks.length > 0 && (
                  <GateRow
                    gate={gate}
                    nextPhaseLabel={nextPhaseLabel}
                    projectId={projectId}
                    context={gateContext}
                  />
                )}
              </div>
            </div>
          );
        })}
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

function PhaseName({ phase, hideIcon }: { phase: PhaseRow; hideIcon?: boolean }) {
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
        {!hideIcon &&
          (phase.actualDate ? (
            <CheckCircle2Icon className="size-3.5 shrink-0 text-positive" />
          ) : (
            <CircleIcon className="size-3.5 shrink-0 text-ink-100" />
          ))}
        <span className="truncate">{phase.label}</span>
      </button>
      {phase.note && <div className="mt-0.5 truncate text-xs text-muted-foreground">{phase.note}</div>}
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
  advance,
}: {
  phase: PhaseRow;
  projectId: number;
  isCurrent: boolean;
  /** Where this phase leads, when it is the current one. */
  advance?: { key: string; label: string; allMet: boolean; outstanding: number };
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
      ) : null}

      <DropdownMenu>
        <DropdownMenuTrigger disabled={pending} render={<Button variant="ghost" size="icon-sm" />}>
          <EllipsisIcon />
          <span className="sr-only">{phase.label} actions</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {/*
            Advancing lives here now. The header no longer carries a phase
            dropdown, so this is the only way the project moves forward, which is
            why it sits first and says where it is going.

            Not disabled when gates are outstanding. Every live project has an
            unmet gate today — no contract has ever been recorded — so disabling
            this would stop all 28 of them moving at all. The count says what is
            missing; setProjectPhase is where a refusal belongs, and when it
            starts refusing, the toast will say which gate.
          */}
          {advance && (
            <DropdownMenuItem
              onClick={() => {
                const fd = new FormData();
                fd.set("projectId", String(projectId));
                fd.set("toPhase", advance.key);
                run(() => setProjectPhase(fd), `Advanced to ${advance.label}`);
              }}
            >
              {advance.allMet
                ? `Advance to ${advance.label}`
                : `Advance to ${advance.label} — ${advance.outstanding} left`}
            </DropdownMenuItem>
          )}
          {isCurrent && !done && (
            <DropdownMenuItem
              onClick={() =>
                run(
                  () => updateMilestone({ id: phase.id, actualDate: today() }),
                  `${phase.label} marked complete`,
                )
              }
            >
              Mark complete
            </DropdownMenuItem>
          )}
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

  return (
    <>
      <div className="mt-2 rounded-card border border-border bg-muted/25">
      {/*
        One row per gate, not a row of chips. Pre-con carries most of the work,
        and its five steps each have a state, a wait and a thing to press —
        which is more than a chip can say without becoming a paragraph.
      */}
      <div className="flex items-center gap-2.5 px-3 py-2">
        <div className="flex w-20 shrink-0 gap-1" aria-hidden>
          {gate.checks.map((check) => (
            <span
              key={check.label}
              className={cn(
                "h-[3px] flex-1 rounded-full",
                check.met ? "bg-positive" : check.next ? "bg-navy/40" : "bg-track",
              )}
            />
          ))}
        </div>
        <span className="min-w-0 text-[12px] text-muted-foreground">
          {gate.allMet ? (
            <>all met — ready for {nextPhaseLabel ?? "the next phase"}</>
          ) : (
            <>
              <span className="tabular-nums">
                {gate.metCount} of {gate.checks.length}
              </span>{" "}
              met to advance
              {nextPhaseLabel ? (
                <>
                  {" to "}
                  <span className="text-ink-500">{nextPhaseLabel}</span>
                </>
              ) : null}
            </>
          )}
        </span>
      </div>

      {gate.checks.map((check) => {
        const clickable = !!(check.key && context);
        return (
          <div
            key={check.label}
            className={cn(
              "grid grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-2.5 border-t border-hairline px-3 py-2",
              check.next && "bg-card",
            )}
          >
            {check.met ? (
              <CheckCircle2Icon className="size-4 text-positive" />
            ) : check.next ? (
              <span className="flex size-4 items-center justify-center">
                <span className="size-2 rounded-full bg-navy" />
              </span>
            ) : (
              <CircleIcon className="size-4 text-ink-100" />
            )}

            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
              <span
                className={cn(
                  "truncate text-[13px]",
                  check.next ? "font-medium text-navy" : check.met ? "text-ink-600" : "text-ink-400",
                )}
              >
                {check.label}
              </span>
              <span className="truncate text-[12px] text-muted-foreground">{check.detail}</span>
              {/*
                The only number on this screen that is somebody else's fault.
                Both gates that can show it are waiting on a vendor, and that
                wait is where turns actually go late.
              */}
              {check.waitingDays != null && (
                <span
                  className={cn(
                    "rounded-control px-1.5 py-0.5 text-[11px] tabular-nums",
                    check.waitingDays >= 5
                      ? "bg-alert/10 text-alert"
                      : "bg-track text-muted-foreground",
                  )}
                >
                  waiting {check.waitingDays}d
                </span>
              )}
            </div>

            {clickable ? (
              <Button
                size="sm"
                variant={check.next ? "default" : "ghost"}
                onClick={() => setOpenGate(check.key!)}
              >
                {check.met ? "View" : check.next ? "Open" : "Open"}
                <ChevronRightIcon className="size-3.5" />
              </Button>
            ) : (
              <span />
            )}
          </div>
        );
      })}
    </div>

      {context && (
        <SelectBidDialog
          open={openGate === "bid" || openGate === "rfp"}
          onOpenChange={(o) => !o && setOpenGate(null)}
          projectId={projectId}
          data={context.bidPackage}
        />
      )}

      {context && (
        <ContractDialog
          open={openGate === "contract"}
          onOpenChange={(o) => !o && setOpenGate(null)}
          projectId={projectId}
          contract={context.contract}
          award={context.award}
        />
      )}

      {context && (
        <DefineScopeDialog
          open={openGate === "scope"}
          onOpenChange={(o) => !o && setOpenGate(null)}
          propertyId={context.propertyId}
          projectId={projectId}
          lines={context.scopeLines}
          scopeConfirmedAt={context.scopeConfirmedAt}
          scopeLocked={context.scopeLocked}
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
    </>
  );
}

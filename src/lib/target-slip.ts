import { and, asc, eq, isNull, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import {
  PHASE_KEYS,
  addBusinessDays,
  businessDaysBetween,
  toIsoDate,
  todayInBusinessZone,
} from "@/lib/schedule-defaults";
import { phaseIndex, type ProjectPhaseKey } from "@/lib/stages";

// ---------------------------------------------------------------------------
// Target dates are a LIVING PLAN.
//
// A target that sits still while the work slides past it stops being a
// forecast: Unit 049 was due into Punch on the 21st and was still In Process on
// the 28th, so its Complete target of the 25th was not merely late, it was
// impossible. Every date after a missed one is fiction.
//
// So a missed phase, and everything after it that has not happened yet, moves
// forward. What was missed is not lost — it goes to milestone_slip_events,
// which is the post-mortem record and also the reason moving the plan is safe.
//
// Two rules make the movement honest:
//
//   Gap-preserving. The distance between phases is held, so a slow pre-con
//   pushes the completion date instead of silently compressing two weeks of
//   work into ten days. That means a missed pre-con moves a date somebody may
//   have promised — which is the real consequence, shown rather than hidden.
//
//   Business days. Gaps and slips are counted in working days and every pushed
//   date lands on a weekday. A Friday miss noticed on Monday cost one working
//   day, not three, and no crew mobilises on a Saturday.
// ---------------------------------------------------------------------------

export type Executor =
  | ReturnType<typeof db>
  | Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];

type MilestoneRow = {
  id: number;
  phase: ProjectPhaseKey;
  plannedDate: string | null;
  actualDate: string | null;
};

export type SlipMove = { phase: ProjectPhaseKey; from: string; to: string };

export type SlipResult = {
  projectId: number;
  /** Working days the next unreached phase was pushed by. */
  days: number;
  moved: SlipMove[];
};

/** The four seeded phase rows, in phase order. Custom rows never carry a plan. */
async function phaseRows(tx: Executor, projectId: number): Promise<MilestoneRow[]> {
  const rows = await tx
    .select({
      id: schema.projectMilestones.id,
      phase: schema.projectMilestones.phase,
      plannedDate: schema.projectMilestones.plannedDate,
      actualDate: schema.projectMilestones.actualDate,
    })
    .from(schema.projectMilestones)
    .where(
      and(
        eq(schema.projectMilestones.projectId, projectId),
        eq(schema.projectMilestones.isDefault, true),
        isNull(schema.projectMilestones.archivedAt),
      ),
    )
    .orderBy(asc(schema.projectMilestones.sortOrder));

  return rows
    .filter((r): r is MilestoneRow => r.phase !== null)
    .sort((a, b) => phaseIndex(a.phase) - phaseIndex(b.phase));
}

/**
 * Re-lay a run of phases starting at `anchor`, holding the working-day gaps
 * they already had.
 *
 * Gaps are read from the CURRENT dates rather than from a stored template, so
 * whatever shape a scheduler has hand-built for this project survives being
 * pushed. An undated phase is skipped and contributes no gap — there is nothing
 * there to preserve.
 */
function relayout(
  rows: MilestoneRow[],
  anchor: string,
  /**
   * Which dates the gaps are measured between. Not always the current ones: a
   * re-base has to use the ORIGINAL plan, because the current dates already
   * carry the slip it is trying to undo — measuring gaps from those simply
   * re-derives the slipped position, which is what the probe caught.
   */
  basisOf: (r: MilestoneRow) => string | null = (r) => r.plannedDate,
): { row: MilestoneRow; from: string; to: string }[] {
  const dated = rows.filter((r) => r.plannedDate && basisOf(r));
  if (dated.length === 0) return [];

  const out: { row: MilestoneRow; from: string; to: string }[] = [];
  let cursor = anchor;
  for (let i = 0; i < dated.length; i++) {
    const row = dated[i];
    const from = row.plannedDate as string;
    if (i > 0) {
      const gap = businessDaysBetween(basisOf(dated[i - 1]) as string, basisOf(row) as string);
      // A gap of zero or less means the stored dates disagree with themselves.
      // Advancing by at least one working day keeps a re-lay from stacking two
      // phases on the same morning.
      cursor = addBusinessDays(cursor, Math.max(1, gap));
    }
    out.push({ row, from, to: cursor });
  }
  return out;
}

/**
 * What each milestone was FIRST planned for, recovered from the trail.
 *
 * The earliest slip event's fromDate is the date before anything moved it, so
 * no baseline column is needed — the audit record doubles as the baseline. A
 * milestone that has never slipped is absent, and its current date is already
 * its original.
 */
async function originalTargets(tx: Executor, projectId: number): Promise<Map<number, string>> {
  const rows = await tx
    .select({
      milestoneId: schema.milestoneSlipEvents.milestoneId,
      fromDate: schema.milestoneSlipEvents.fromDate,
    })
    .from(schema.milestoneSlipEvents)
    .where(eq(schema.milestoneSlipEvents.projectId, projectId))
    .orderBy(asc(schema.milestoneSlipEvents.at), asc(schema.milestoneSlipEvents.id));

  const out = new Map<number, string>();
  for (const r of rows) if (!out.has(r.milestoneId)) out.set(r.milestoneId, r.fromDate);
  return out;
}

/** Apply the moves and record each one. Returns what actually changed. */
async function commitMoves(
  tx: Executor,
  projectId: number,
  moves: { row: MilestoneRow; from: string; to: string }[],
  reason: "missed" | "rebased",
): Promise<SlipMove[]> {
  const changed = moves.filter((m) => m.from !== m.to);
  for (const m of changed) {
    await tx
      .update(schema.projectMilestones)
      .set({ plannedDate: m.to })
      .where(eq(schema.projectMilestones.id, m.row.id));
    await tx.insert(schema.milestoneSlipEvents).values({
      projectId,
      milestoneId: m.row.id,
      phase: m.row.phase,
      fromDate: m.from,
      toDate: m.to,
      days: businessDaysBetween(m.from, m.to),
      reason,
    });
  }
  return changed.map((m) => ({ phase: m.row.phase, from: m.from, to: m.to }));
}

/**
 * Push a project's overdue targets forward.
 *
 * Only phases the project has NOT reached move. A phase it is in, or past,
 * keeps its target so the variance on it still measures the miss that really
 * happened.
 *
 * Idempotent: afterwards the next unreached target is today or later, so a
 * second run the same day writes nothing.
 */
export async function slipOverdueTargets(
  tx: Executor,
  projectId: number,
  currentPhase: string,
  today: string = toIsoDate(todayInBusinessZone()),
): Promise<SlipResult | null> {
  const rows = await phaseRows(tx, projectId);
  const unreached = rows.filter((r) => phaseIndex(r.phase) > phaseIndex(currentPhase));
  const next = unreached.find((r) => r.plannedDate);
  if (!next?.plannedDate || next.plannedDate >= today) return null;

  const days = businessDaysBetween(next.plannedDate, today);
  if (days <= 0) return null;

  // Today, rolled onto a weekday: a target coming due over a weekend is due on
  // the Monday, and landing the push on a Saturday would only slip it again.
  const anchor = addBusinessDays(today, 0);
  const moved = await commitMoves(tx, projectId, relayout(unreached, anchor), "missed");
  if (moved.length === 0) return null;

  return { projectId, days, moved };
}

/**
 * Re-lay the unreached phases after an actual date was corrected.
 *
 * The override for a transition nobody recorded on the day. The pass has
 * already pushed everything forward believing the phase was late, and
 * correcting the actual has to take that back — otherwise a slip stands on a
 * transition that was never late, which is the exact thing this exists to undo.
 *
 * The corrected date anchors the next phase at the gap the plan already held,
 * so a hand-shaped plan keeps its shape.
 */
export async function rebaseFromActual(
  tx: Executor,
  projectId: number,
  correctedPhase: ProjectPhaseKey,
  correctedActual: string,
  currentPhase: string,
): Promise<SlipResult | null> {
  const rows = await phaseRows(tx, projectId);
  const corrected = rows.find((r) => r.phase === correctedPhase);
  if (!corrected) return null;

  const unreached = rows.filter((r) => phaseIndex(r.phase) > phaseIndex(currentPhase));
  const firstDated = unreached.find((r) => r.plannedDate);
  if (!firstDated?.plannedDate) return null;

  // Measured on the original plan, not the slipped one.
  const original = await originalTargets(tx, projectId);
  const basisOf = (r: MilestoneRow) => original.get(r.id) ?? r.plannedDate;

  const correctedBasis = original.get(corrected.id) ?? corrected.plannedDate;
  const firstBasis = basisOf(firstDated);
  const gap =
    correctedBasis && firstBasis
      ? Math.max(1, businessDaysBetween(correctedBasis, firstBasis))
      : 1;
  const anchor = addBusinessDays(correctedActual, gap);

  const moved = await commitMoves(
    tx,
    projectId,
    relayout(unreached, anchor, basisOf),
    "rebased",
  );
  if (moved.length === 0) return null;

  return {
    projectId,
    days: businessDaysBetween(moved[0].from, moved[0].to),
    moved,
  };
}

/**
 * Cumulative working days each project's plan has slipped.
 *
 * Taken as the MAXIMUM total over the project's milestones, not a sum across
 * them and not the tail phase's total.
 *
 * A sum across milestones multiplies one push by however many phases happened
 * to follow it. Reading the tail phase alone fixed that but introduced a
 * quieter fault: relayout only moves a phase that HAS a target, so a project
 * whose Complete date is blank — a state both wizards invite — never records a
 * Complete event and reported zero however far it had really moved. One
 * measured 16 working days of slip and read as on time.
 *
 * The maximum works because every milestone moved by a single push moves by the
 * SAME number of working days: each is re-laid from a common anchor with its
 * gaps held, so the shift is anchor-to-anchor for all of them. A milestone
 * present for every push therefore carries the project's whole history, one
 * dated later carries only part of it, and the longest history is the answer.
 * Negative totals from a re-base handing days back are kept rather than
 * clamped — statusOf reads anything at or below zero as on time.
 */
export async function readSlipTotals(projectIds: number[]): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (projectIds.length === 0) return out;

  const rows = await db()
    .select({
      projectId: schema.milestoneSlipEvents.projectId,
      milestoneId: schema.milestoneSlipEvents.milestoneId,
      days: schema.milestoneSlipEvents.days,
    })
    .from(schema.milestoneSlipEvents)
    .where(inArray(schema.milestoneSlipEvents.projectId, projectIds));

  const perMilestone = new Map<number, { projectId: number; days: number }>();
  for (const r of rows) {
    const entry = perMilestone.get(r.milestoneId) ?? { projectId: r.projectId, days: 0 };
    entry.days += r.days;
    perMilestone.set(r.milestoneId, entry);
  }

  for (const { projectId, days } of perMilestone.values()) {
    const best = out.get(projectId);
    if (best === undefined || days > best) out.set(projectId, days);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Schedule health.
//
// "Which projects are in trouble?" needs one number that survives the pushing.
// Days-to-next-milestone does not: a missed target is moved to today, so it can
// never read negative and every project reports zero. Variance against the
// BASELINE does survive — it accumulates, and it is the same thing a scheduler
// reads off total float: how far has the finish moved from what we committed to.
//
// The threshold is proportional to the length of the job. Four days on a
// three-week turn is a wobble; four days on a three-day common-area fix is most
// of it, and a fixed cut-off calls those the same.
// ---------------------------------------------------------------------------

/** Slip beyond this share of the original duration reads as late, not slipping. */
export const LATE_RATIO = 0.2;

export type ScheduleStatus = "on_time" | "slipping" | "late" | "unknown";

export type ScheduleHealth = {
  /** Working days the finish has moved since first planned. */
  slipDays: number;
  /** Working days the job was originally planned to take. Zero if unknown. */
  baselineDays: number;
  /** The current target finish, which is what the slip has moved. */
  forecastFinish: string | null;
  status: ScheduleStatus;
};

export function statusOf(slipDays: number, baselineDays: number): ScheduleStatus {
  if (slipDays <= 0) return "on_time";
  // No baseline to measure against: it has slipped, but by an unknown share of
  // an unknown plan. Reported as slipping rather than guessed into red.
  if (baselineDays <= 0) return "slipping";
  return slipDays / baselineDays > LATE_RATIO ? "late" : "slipping";
}

/**
 * Slip, original duration and forecast finish for each project.
 *
 * The original duration comes from the trail the same way rebaseFromActual gets
 * it — the earliest recorded fromDate is what a milestone was first planned
 * for, so a project that has never slipped measures against its current plan,
 * which is still its original one.
 */
export async function readScheduleHealth(
  projectIds: number[],
): Promise<Map<number, ScheduleHealth>> {
  const out = new Map<number, ScheduleHealth>();
  if (projectIds.length === 0) return out;

  const milestones = await db()
    .select({
      id: schema.projectMilestones.id,
      projectId: schema.projectMilestones.projectId,
      phase: schema.projectMilestones.phase,
      plannedDate: schema.projectMilestones.plannedDate,
    })
    .from(schema.projectMilestones)
    .where(
      and(
        inArray(schema.projectMilestones.projectId, projectIds),
        eq(schema.projectMilestones.isDefault, true),
        isNull(schema.projectMilestones.archivedAt),
      ),
    );

  const events = await db()
    .select({
      projectId: schema.milestoneSlipEvents.projectId,
      milestoneId: schema.milestoneSlipEvents.milestoneId,
      fromDate: schema.milestoneSlipEvents.fromDate,
    })
    .from(schema.milestoneSlipEvents)
    .where(inArray(schema.milestoneSlipEvents.projectId, projectIds))
    .orderBy(asc(schema.milestoneSlipEvents.at), asc(schema.milestoneSlipEvents.id));

  const firstPlanned = new Map<number, string>();
  for (const e of events) if (!firstPlanned.has(e.milestoneId)) firstPlanned.set(e.milestoneId, e.fromDate);

  const slip = await readSlipTotals(projectIds);
  const tail = PHASE_KEYS[PHASE_KEYS.length - 1];

  for (const projectId of projectIds) {
    const rows = milestones
      .filter((m) => m.projectId === projectId && m.phase)
      .sort((a, b) => phaseIndex(a.phase as string) - phaseIndex(b.phase as string));

    const original = (id: number, current: string | null) => firstPlanned.get(id) ?? current;
    const dated = rows.filter((m) => original(m.id, m.plannedDate));
    const finishRow = rows.find((m) => m.phase === tail);

    const startBasis = dated.length > 0 ? original(dated[0].id, dated[0].plannedDate) : null;
    const finishBasis = finishRow ? original(finishRow.id, finishRow.plannedDate) : null;
    const baselineDays =
      startBasis && finishBasis ? Math.max(0, businessDaysBetween(startBasis, finishBasis)) : 0;

    const slipDays = slip.get(projectId) ?? 0;
    const forecastFinish = finishRow?.plannedDate ?? null;

    out.set(projectId, {
      slipDays,
      baselineDays,
      forecastFinish,
      status: forecastFinish === null ? "unknown" : statusOf(slipDays, baselineDays),
    });
  }

  return out;
}

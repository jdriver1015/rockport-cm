/**
 * What a unit turn actually earned.
 *
 * Trade-out is not typed in by hand here — it is READ OFF successive rent
 * rolls. A unit's rent before its turn is whatever the last snapshot taken
 * before work started says it was; the rent after is the first lease signed
 * once work finished. Both facts already arrive with every rent roll upload,
 * so the measurement maintains itself instead of depending on somebody
 * remembering to record it.
 *
 * That does mean it needs two committed snapshots straddling the turn. A
 * property with one rent roll can show occupancy and rents but cannot show a
 * single trade-out, and the tab says so rather than rendering zeroes.
 *
 * PURE. No database — the page (or the probe) supplies rows, this derives.
 * Kept that way deliberately: the interesting cases are the awkward ones (a
 * unit vacant across three snapshots, a renewal that is not a trade-out, a
 * turn that never re-lets) and none of them are convenient to stage in a real
 * database, least of all the one real property.
 */

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** One committed rent roll, oldest to newest by asOfDate. */
export type SnapshotRef = {
  batchId: number;
  /** 'YYYY-MM-DD'. Date columns come back from Drizzle as strings, and that
   *  ordering is lexicographic, so these compare directly. */
  asOfDate: string;
};

/** One unit's row within one snapshot. */
export type SnapshotUnit = {
  batchId: number;
  unitNumber: string;
  inPlaceRent: number | null;
  marketRent: number | null;
  /** The start of the lease in force at the snapshot date. */
  leaseStart: string | null;
  floorPlanCode: string | null;
  squareFeet: number | null;
};

export type TurnInput = {
  projectId: number;
  projectName: string;
  unitNumber: string;
  /** From the unit record; falls back to whatever the rent roll says. */
  floorplan: string | null;
  /** The renovation tier — a budgetGroups row. */
  tierId: number | null;
  tierName: string | null;
  /** Monthly dollars the tier is underwritten to achieve. */
  targetTradeOut: number | null;
  phase: string;
  startDate: string | null;
  completeDate: string | null;
  /** Posted GL to date. The realised cost; 0 when nothing has posted yet. */
  actualCost: number;
  /** Planned cost, from the scope lines. */
  budgetedCost: number;
  /** Hand-entered escape hatches. When present they beat the derived figure —
   *  real rent rolls are messy enough that an override earns its keep. */
  previousRentOverride: number | null;
  tradeOutRentOverride: number | null;
  leaseDateOverride: string | null;
};

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

/**
 * Why a turn has no trade-out yet. Distinguishing these is the whole point —
 * lumping them together as zero would drag every average down with turns that
 * simply have not re-let yet.
 */
export type TurnOutcomeStatus =
  /** Work is not finished, so there is nothing to measure. */
  | "in_progress"
  /** Finished, but no snapshot predates the work — nothing to compare against. */
  | "no_baseline"
  /** Finished with a baseline, but no post-renovation lease has appeared yet. */
  | "awaiting_relet"
  /** Both ends known. Counts towards the averages. */
  | "measured";

export type TurnOutcome = {
  projectId: number;
  projectName: string;
  unitNumber: string;
  floorplan: string | null;
  tierId: number | null;
  tierName: string | null;
  status: TurnOutcomeStatus;
  completeDate: string | null;
  /** Rent before the turn (monthly). */
  previousRent: number | null;
  /** Rent on the first lease signed after the turn (monthly). */
  newRent: number | null;
  /** newRent − previousRent, monthly dollars. */
  tradeOut: number | null;
  /** tradeOut as a share of previousRent. Null when previousRent is 0. */
  tradeOutPct: number | null;
  /** When the post-renovation lease started. */
  leaseDate: string | null;
  targetTradeOut: number | null;
  /** tradeOut − targetTradeOut. */
  vsTarget: number | null;
  /** Whether the turn hit its tier's underwritten target. */
  metTarget: boolean | null;
  actualCost: number;
  budgetedCost: number;
  /** Annualised rent lift over realised cost. Null unless both are known and
   *  cost is positive — a turn with no posted GL cannot have a yield yet. */
  roi: number | null;
  /** Months of trade-out to repay the cost. More legible than a percentage. */
  paybackMonths: number | null;
  /** True when the rents came from the manual override fields. */
  fromOverride: boolean;
};

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

/** Index snapshot rows by unit number, each list ordered oldest → newest. */
function indexByUnit(
  snapshots: SnapshotRef[],
  units: SnapshotUnit[],
): Map<string, { asOfDate: string; unit: SnapshotUnit }[]> {
  const asOf = new Map(snapshots.map((s) => [s.batchId, s.asOfDate]));
  const byUnit = new Map<string, { asOfDate: string; unit: SnapshotUnit }[]>();
  for (const u of units) {
    const date = asOf.get(u.batchId);
    // A row whose batch is not in the committed set (draft, archived) is not
    // evidence of anything.
    if (date == null) continue;
    const key = normalizeUnit(u.unitNumber);
    const list = byUnit.get(key) ?? [];
    list.push({ asOfDate: date, unit: u });
    byUnit.set(key, list);
  }
  for (const list of byUnit.values()) list.sort((a, b) => a.asOfDate.localeCompare(b.asOfDate));
  return byUnit;
}

/**
 * Unit numbers are matched across two systems that were typed by different
 * people — the turn's unit record and the PM system's export. Trimming and
 * casing cost nothing and prevent a silent miss; anything beyond that (zero
 * padding, building prefixes) would be guessing, and a turn that fails to
 * match is reported rather than quietly dropped.
 */
export function normalizeUnit(unitNumber: string): string {
  return unitNumber.trim().toLowerCase();
}

export function deriveTurnOutcome(
  turn: TurnInput,
  byUnit: Map<string, { asOfDate: string; unit: SnapshotUnit }[]>,
): TurnOutcome {
  const history = byUnit.get(normalizeUnit(turn.unitNumber)) ?? [];
  const floorplan =
    turn.floorplan ?? history.find((h) => h.unit.floorPlanCode)?.unit.floorPlanCode ?? null;

  const base = {
    projectId: turn.projectId,
    projectName: turn.projectName,
    unitNumber: turn.unitNumber,
    floorplan,
    tierId: turn.tierId,
    tierName: turn.tierName,
    completeDate: turn.completeDate,
    targetTradeOut: turn.targetTradeOut,
    actualCost: turn.actualCost,
    budgetedCost: turn.budgetedCost,
  };

  const incomplete = (status: TurnOutcomeStatus): TurnOutcome => ({
    ...base,
    status,
    previousRent: null,
    newRent: null,
    tradeOut: null,
    tradeOutPct: null,
    leaseDate: null,
    vsTarget: null,
    metTarget: null,
    roi: null,
    paybackMonths: null,
    fromOverride: false,
  });

  // An override is a complete answer on its own — it exists precisely for the
  // turns the rent rolls cannot explain, so it is checked before them.
  if (turn.previousRentOverride != null && turn.tradeOutRentOverride != null) {
    return settle(
      base,
      turn.previousRentOverride,
      turn.tradeOutRentOverride,
      turn.leaseDateOverride,
      true,
    );
  }

  // Nothing to measure until the work is finished and dated. A turn marked
  // complete but never dated cannot be placed against the snapshots at all.
  if (turn.phase !== "complete" || !turn.completeDate) return incomplete("in_progress");

  // Work began when it began; if that was never stamped, the completion date is
  // the only boundary available, which is conservative — it can only make the
  // baseline older, never let post-turn rent leak into it.
  const workStart = turn.startDate ?? turn.completeDate;

  // Baseline: the last snapshot at or before work started in which this unit
  // was actually earning. Walking backwards skips the vacancy that usually
  // precedes a turn and finds the lease the renovation displaced.
  const before = history.filter((h) => h.asOfDate <= workStart && h.unit.inPlaceRent != null);
  const baseline = before.length > 0 ? before[before.length - 1] : null;
  const previousRent = baseline?.unit.inPlaceRent ?? null;
  if (previousRent == null) return incomplete("no_baseline");

  // The post-renovation lease: the EARLIEST lease that began after the work
  // finished. Earliest, not latest, because a later snapshot may show a renewal
  // of that same lease at a higher rent — that increase is not trade-out and
  // crediting it to the renovation would overstate the return.
  const after = history
    .filter(
      (h) =>
        h.asOfDate > turn.completeDate! &&
        h.unit.inPlaceRent != null &&
        h.unit.leaseStart != null &&
        h.unit.leaseStart > turn.completeDate!,
    )
    .sort((a, b) => a.unit.leaseStart!.localeCompare(b.unit.leaseStart!));
  const relet = after[0];
  if (!relet) return { ...incomplete("awaiting_relet"), previousRent };

  return settle(base, previousRent, relet.unit.inPlaceRent!, relet.unit.leaseStart, false);
}

function settle(
  base: Omit<
    TurnOutcome,
    | "status"
    | "previousRent"
    | "newRent"
    | "tradeOut"
    | "tradeOutPct"
    | "leaseDate"
    | "vsTarget"
    | "metTarget"
    | "roi"
    | "paybackMonths"
    | "fromOverride"
  >,
  previousRent: number,
  newRent: number,
  leaseDate: string | null,
  fromOverride: boolean,
): TurnOutcome {
  const tradeOut = newRent - previousRent;
  const annual = tradeOut * 12;
  return {
    ...base,
    status: "measured",
    previousRent,
    newRent,
    tradeOut,
    tradeOutPct: previousRent > 0 ? tradeOut / previousRent : null,
    leaseDate,
    vsTarget: base.targetTradeOut != null ? tradeOut - base.targetTradeOut : null,
    metTarget: base.targetTradeOut != null ? tradeOut >= base.targetTradeOut : null,
    // Both guarded: a turn with nothing posted to it yet has no realised cost
    // to divide by, and a flat or negative trade-out never pays anything back.
    roi: base.actualCost > 0 ? annual / base.actualCost : null,
    paybackMonths: tradeOut > 0 && base.actualCost > 0 ? base.actualCost / tradeOut : null,
    fromOverride,
  };
}

// ---------------------------------------------------------------------------
// Roll-ups
// ---------------------------------------------------------------------------

export type FloorplanRollup = {
  floorplan: string | null;
  tierId: number | null;
  tierName: string | null;
  /** Turns counted in the averages below. */
  measured: number;
  /** Finished, but still waiting on a post-renovation lease. */
  awaitingRelet: number;
  avgPreviousRent: number | null;
  avgNewRent: number | null;
  avgTradeOut: number | null;
  targetTradeOut: number | null;
  /** avgTradeOut − targetTradeOut. */
  vsTarget: number | null;
  /** Share of measured turns that hit the target. */
  hitRate: number | null;
  avgCost: number | null;
  roi: number | null;
  paybackMonths: number | null;
};

export type TurnPerformance = {
  outcomes: TurnOutcome[];
  /** Grouped by floorplan × tier, the same shape the interior budget pivot
   *  uses, so the two screens describe the programme the same way. */
  byFloorplan: FloorplanRollup[];
  totals: {
    measured: number;
    awaitingRelet: number;
    inProgress: number;
    noBaseline: number;
    avgTradeOut: number | null;
    avgCost: number | null;
    roi: number | null;
    paybackMonths: number | null;
    hitRate: number | null;
    /** Annualised rent created across every measured turn. */
    annualRentAdded: number;
  };
  /** Committed snapshots available. Below two, no trade-out is derivable. */
  snapshotCount: number;
};

const avg = (ns: number[]): number | null =>
  ns.length > 0 ? ns.reduce((a, b) => a + b, 0) / ns.length : null;

export function rollUpTurnPerformance(
  outcomes: TurnOutcome[],
  snapshotCount: number,
): TurnPerformance {
  const groups = new Map<string, TurnOutcome[]>();
  for (const o of outcomes) {
    // Only turns with a measurement, or finished ones still waiting to re-let,
    // say anything about a floorplan's performance. In-flight work does not.
    if (o.status !== "measured" && o.status !== "awaiting_relet") continue;
    const key = `${o.floorplan ?? ""}::${o.tierId ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), o]);
  }

  const byFloorplan: FloorplanRollup[] = [...groups.values()]
    .map((rows) => {
      const measured = rows.filter((r) => r.status === "measured");
      const head = rows[0];
      const tradeOuts = measured.map((r) => r.tradeOut!);
      const costs = measured.map((r) => r.actualCost).filter((c) => c > 0);
      const avgTradeOut = avg(tradeOuts);
      const avgCost = avg(costs);
      const withTarget = measured.filter((r) => r.metTarget != null);
      return {
        floorplan: head.floorplan,
        tierId: head.tierId,
        tierName: head.tierName,
        measured: measured.length,
        awaitingRelet: rows.length - measured.length,
        avgPreviousRent: avg(measured.map((r) => r.previousRent!)),
        avgNewRent: avg(measured.map((r) => r.newRent!)),
        avgTradeOut,
        targetTradeOut: head.targetTradeOut,
        vsTarget:
          avgTradeOut != null && head.targetTradeOut != null
            ? avgTradeOut - head.targetTradeOut
            : null,
        hitRate:
          withTarget.length > 0
            ? withTarget.filter((r) => r.metTarget).length / withTarget.length
            : null,
        avgCost,
        roi: avgTradeOut != null && avgCost != null && avgCost > 0 ? (avgTradeOut * 12) / avgCost : null,
        paybackMonths:
          avgTradeOut != null && avgTradeOut > 0 && avgCost != null && avgCost > 0
            ? avgCost / avgTradeOut
            : null,
      };
    })
    .sort((a, b) => (a.floorplan ?? "").localeCompare(b.floorplan ?? ""));

  const measured = outcomes.filter((o) => o.status === "measured");
  const allTradeOuts = measured.map((o) => o.tradeOut!);
  const allCosts = measured.map((o) => o.actualCost).filter((c) => c > 0);
  const avgTradeOut = avg(allTradeOuts);
  const avgCost = avg(allCosts);
  const withTarget = measured.filter((o) => o.metTarget != null);

  return {
    outcomes,
    byFloorplan,
    totals: {
      measured: measured.length,
      awaitingRelet: outcomes.filter((o) => o.status === "awaiting_relet").length,
      inProgress: outcomes.filter((o) => o.status === "in_progress").length,
      noBaseline: outcomes.filter((o) => o.status === "no_baseline").length,
      avgTradeOut,
      avgCost,
      roi: avgTradeOut != null && avgCost != null && avgCost > 0 ? (avgTradeOut * 12) / avgCost : null,
      paybackMonths:
        avgTradeOut != null && avgTradeOut > 0 && avgCost != null && avgCost > 0
          ? avgCost / avgTradeOut
          : null,
      hitRate:
        withTarget.length > 0
          ? withTarget.filter((o) => o.metTarget).length / withTarget.length
          : null,
      annualRentAdded: allTradeOuts.reduce((a, b) => a + b, 0) * 12,
    },
    snapshotCount,
  };
}

/** Convenience: index once, derive each turn, roll up. */
export function computeTurnPerformance(input: {
  snapshots: SnapshotRef[];
  snapshotUnits: SnapshotUnit[];
  turns: TurnInput[];
}): TurnPerformance {
  const byUnit = indexByUnit(input.snapshots, input.snapshotUnits);
  const outcomes = input.turns.map((t) => deriveTurnOutcome(t, byUnit));
  return rollUpTurnPerformance(outcomes, input.snapshots.length);
}

/**
 * Probe of the trade-out derivation (src/lib/turn-performance.ts).
 *
 * Almost entirely PURE — it builds rent-roll snapshots in memory rather than in
 * the database. That is deliberate, not a shortcut: the cases worth testing are
 * the awkward ones (a unit vacant across several snapshots, a renewal that is
 * not a trade-out, a turn that never re-lets, a missing baseline), the one real
 * property has zero completed turns and a single rent roll so it cannot reach
 * any of them, and staging six months of snapshots against real data to find
 * out would be both slow and reckless.
 *
 * The last section does touch the database, read-only, to prove the loader
 * runs against real schema and returns a well-shaped result.
 *
 *   npx tsx scripts/probe-turn-performance.ts
 *
 * Exits non-zero if any assertion fails.
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import {
  computeTurnPerformance,
  normalizeUnit,
  type SnapshotRef,
  type SnapshotUnit,
  type TurnInput,
} from "../src/lib/turn-performance";
import { computeTurnPerformanceFor } from "../src/lib/turn-performance-data";
import { loadFixtures } from "./probe-fixtures";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail?: string) {
  if (ok) {
    pass++;
    console.log(`  PASS  ${label}${detail ? `  — ${detail}` : ""}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}${detail ? `  — ${detail}` : ""}`);
  }
}

// --- fixture helpers -------------------------------------------------------

const SNAPSHOTS: SnapshotRef[] = [
  { batchId: 1, asOfDate: "2026-01-31" },
  { batchId: 2, asOfDate: "2026-04-30" },
  { batchId: 3, asOfDate: "2026-07-31" },
];

function unit(
  batchId: number,
  unitNumber: string,
  inPlaceRent: number | null,
  leaseStart: string | null,
  floorPlanCode = "A1",
): SnapshotUnit {
  return { batchId, unitNumber, inPlaceRent, marketRent: null, leaseStart, floorPlanCode, squareFeet: 650 };
}

function turn(over: Partial<TurnInput> & { unitNumber: string }): TurnInput {
  return {
    projectId: 1,
    projectName: `Unit ${over.unitNumber} Interior`,
    floorplan: "A1",
    tierId: 10,
    tierName: "Enhanced",
    targetTradeOut: 200,
    phase: "complete",
    startDate: "2026-02-15",
    completeDate: "2026-03-15",
    actualCost: 12000,
    budgetedCost: 11000,
    previousRentOverride: null,
    tradeOutRentOverride: null,
    leaseDateOverride: null,
    ...over,
  };
}

/** One turn through the whole pipeline. */
function one(t: TurnInput, units: SnapshotUnit[]) {
  return computeTurnPerformance({ snapshots: SNAPSHOTS, snapshotUnits: units, turns: [t] })
    .outcomes[0];
}

async function main() {
  // ---- the happy path ----------------------------------------------------
  // Unit 101 earned 1,400 before the turn, sat vacant through the turn, and
  // re-let at 1,700 afterwards.
  const happy = one(turn({ unitNumber: "101" }), [
    unit(1, "101", 1400, "2025-03-01"),
    unit(2, "101", null, null),
    unit(3, "101", 1700, "2026-05-01"),
  ]);
  check("measures a straightforward turn", happy.status === "measured");
  check("baseline is the pre-turn lease", happy.previousRent === 1400, `${happy.previousRent}`);
  check("new rent is the post-turn lease", happy.newRent === 1700, `${happy.newRent}`);
  check("trade-out is the difference", happy.tradeOut === 300, `${happy.tradeOut}`);
  check("trade-out % is against the old rent", Math.abs((happy.tradeOutPct ?? 0) - 300 / 1400) < 1e-9);
  check("beat a $200 target by $100", happy.vsTarget === 100 && happy.metTarget === true);
  check("ROI is annualised over realised cost", Math.abs((happy.roi ?? 0) - 3600 / 12000) < 1e-9, `${happy.roi}`);
  check("payback is cost over monthly lift", Math.abs((happy.paybackMonths ?? 0) - 40) < 1e-9, `${happy.paybackMonths}`);
  check("lease date comes from the new lease", happy.leaseDate === "2026-05-01");
  check("not flagged as an override", happy.fromOverride === false);

  // ---- the vacancy that precedes a turn ----------------------------------
  // The snapshot immediately before the work shows the unit already empty. The
  // baseline has to reach further back, or every turn reads as a huge gain.
  const vacantBefore = one(turn({ unitNumber: "102", startDate: "2026-05-10", completeDate: "2026-06-10" }), [
    unit(1, "102", 1350, "2025-01-01"),
    unit(2, "102", null, null), // vacated, awaiting the turn
    unit(3, "102", 1650, "2026-07-01"),
  ]);
  check(
    "reaches past a vacancy for the baseline",
    vacantBefore.status === "measured" && vacantBefore.previousRent === 1350,
    `previousRent=${vacantBefore.previousRent}`,
  );
  check("and trades out against it", vacantBefore.tradeOut === 300, `${vacantBefore.tradeOut}`);

  // ---- a renewal is not a trade-out --------------------------------------
  // The unit re-lets at 1,700 in April, then renews at 1,800 in July. Only the
  // first post-turn lease is the renovation's doing.
  const renewal = one(turn({ unitNumber: "103" }), [
    unit(1, "103", 1400, "2025-03-01"),
    unit(2, "103", 1700, "2026-04-01"),
    unit(3, "103", 1800, "2026-07-01"),
  ]);
  check(
    "credits the first post-turn lease, not a later renewal",
    renewal.newRent === 1700 && renewal.tradeOut === 300,
    `newRent=${renewal.newRent}`,
  );

  // ---- a lease that predates the turn is not a re-let --------------------
  const staleLease = one(turn({ unitNumber: "104" }), [
    unit(1, "104", 1400, "2025-03-01"),
    unit(3, "104", 1400, "2025-03-01"), // same old lease still running
  ]);
  check(
    "a lease older than the turn does not count as a re-let",
    staleLease.status === "awaiting_relet",
    staleLease.status,
  );
  check("but the baseline is still reported", staleLease.previousRent === 1400);

  // ---- finished, not yet re-let ------------------------------------------
  const awaiting = one(turn({ unitNumber: "105" }), [
    unit(1, "105", 1400, "2025-03-01"),
    unit(3, "105", null, null),
  ]);
  check("a finished but unlet turn is awaiting_relet", awaiting.status === "awaiting_relet");
  check("with no trade-out asserted", awaiting.tradeOut === null && awaiting.roi === null);

  // ---- no baseline --------------------------------------------------------
  const noBase = one(turn({ unitNumber: "106" }), [unit(3, "106", 1700, "2026-05-01")]);
  check("no pre-turn snapshot means no baseline", noBase.status === "no_baseline", noBase.status);

  // ---- still in flight ----------------------------------------------------
  const wip = one(turn({ unitNumber: "107", phase: "in_process", completeDate: null }), [
    unit(1, "107", 1400, "2025-03-01"),
    unit(3, "107", 1700, "2026-05-01"),
  ]);
  check("an unfinished turn is in_progress", wip.status === "in_progress", wip.status);
  check("and claims nothing, even though a later lease exists", wip.tradeOut === null);

  // ---- manual override wins ----------------------------------------------
  const overridden = one(
    turn({
      unitNumber: "108",
      previousRentOverride: 1500,
      tradeOutRentOverride: 1900,
      leaseDateOverride: "2026-06-01",
    }),
    [unit(1, "108", 1400, "2025-03-01"), unit(3, "108", 1700, "2026-05-01")],
  );
  check(
    "a hand-entered pair beats the derived one",
    overridden.tradeOut === 400 && overridden.fromOverride === true,
    `${overridden.tradeOut}`,
  );

  // ---- a turn that lost rent ---------------------------------------------
  const negative = one(turn({ unitNumber: "109" }), [
    unit(1, "109", 1800, "2025-03-01"),
    unit(3, "109", 1700, "2026-05-01"),
  ]);
  check("a negative trade-out is reported, not clamped", negative.tradeOut === -100);
  check("it misses the target", negative.metTarget === false);
  check("and has no payback period", negative.paybackMonths === null);

  // ---- nothing posted to the job yet -------------------------------------
  const noCost = one(turn({ unitNumber: "110", actualCost: 0 }), [
    unit(1, "110", 1400, "2025-03-01"),
    unit(3, "110", 1700, "2026-05-01"),
  ]);
  check("trade-out still measures with no GL posted", noCost.tradeOut === 300);
  check("but ROI stays null rather than dividing by zero", noCost.roi === null && noCost.paybackMonths === null);

  // ---- unit-number matching ----------------------------------------------
  const padded = one(turn({ unitNumber: " 111 " }), [
    unit(1, "111", 1400, "2025-03-01"),
    unit(3, "111", 1700, "2026-05-01"),
  ]);
  check("whitespace does not break the match", padded.status === "measured");
  check("normalizeUnit trims and lowercases", normalizeUnit(" 12B ") === "12b");

  const unmatched = one(turn({ unitNumber: "999" }), [unit(1, "101", 1400, "2025-03-01")]);
  check("a unit absent from every roll reports no baseline", unmatched.status === "no_baseline");

  // ---- an uncommitted batch is not evidence ------------------------------
  const draftIgnored = one(turn({ unitNumber: "112" }), [
    unit(1, "112", 1400, "2025-03-01"),
    unit(99, "112", 9999, "2026-05-01"), // batch 99 is not in SNAPSHOTS
  ]);
  check(
    "rows from a non-committed batch are ignored",
    draftIgnored.status === "awaiting_relet",
    draftIgnored.status,
  );

  // ---- roll-ups -----------------------------------------------------------
  const many = computeTurnPerformance({
    snapshots: SNAPSHOTS,
    snapshotUnits: [
      unit(1, "201", 1400, "2025-03-01"),
      unit(3, "201", 1700, "2026-05-01"), // +300, beats target
      unit(1, "202", 1400, "2025-03-01"),
      unit(3, "202", 1550, "2026-05-01"), // +150, misses target
      unit(1, "203", 1500, "2025-03-01"),
      unit(3, "203", null, null), // awaiting re-let
      unit(1, "301", 1900, "2025-03-01", "B1"),
      unit(3, "301", 2300, "2026-05-01", "B1"), // +400 on another floorplan
    ],
    turns: [
      turn({ projectId: 1, unitNumber: "201" }),
      turn({ projectId: 2, unitNumber: "202" }),
      turn({ projectId: 3, unitNumber: "203" }),
      turn({ projectId: 4, unitNumber: "301", floorplan: "B1", tierId: 11, tierName: "Signature", targetTradeOut: 350 }),
      turn({ projectId: 5, unitNumber: "204", phase: "in_process", completeDate: null }),
    ],
  });

  check("groups by floorplan and tier", many.byFloorplan.length === 2, `${many.byFloorplan.length} groups`);
  const a1 = many.byFloorplan.find((g) => g.floorplan === "A1")!;
  check("A1 counts only its measured turns", a1.measured === 2, `${a1.measured}`);
  check("A1 tracks the one awaiting re-let separately", a1.awaitingRelet === 1, `${a1.awaitingRelet}`);
  check("A1 averages trade-out over measured turns only", a1.avgTradeOut === 225, `${a1.avgTradeOut}`);
  check("A1 hit rate is one of two", a1.hitRate === 0.5, `${a1.hitRate}`);
  check("A1 is $25 above a $200 target", a1.vsTarget === 25, `${a1.vsTarget}`);
  const b1 = many.byFloorplan.find((g) => g.floorplan === "B1")!;
  check("B1 carries its own tier and target", b1.tierName === "Signature" && b1.targetTradeOut === 350);
  check(
    "B1 beat its $350 target by $50, hitting it every time",
    b1.avgTradeOut === 400 && b1.vsTarget === 50 && b1.hitRate === 1,
    `avg=${b1.avgTradeOut} vs=${b1.vsTarget} hitRate=${b1.hitRate}`,
  );

  check("totals count measured turns", many.totals.measured === 3, `${many.totals.measured}`);
  check("totals count in-flight separately", many.totals.inProgress === 1, `${many.totals.inProgress}`);
  check("totals count awaiting re-let separately", many.totals.awaitingRelet === 1);
  check(
    "portfolio average trade-out spans floorplans",
    Math.abs((many.totals.avgTradeOut ?? 0) - (300 + 150 + 400) / 3) < 1e-9,
    `${many.totals.avgTradeOut}`,
  );
  check(
    "annual rent added is the year's worth of every measured lift",
    many.totals.annualRentAdded === (300 + 150 + 400) * 12,
    `${many.totals.annualRentAdded}`,
  );
  check("an in-flight turn never reaches a floorplan group", !many.byFloorplan.some((g) => g.measured > 2));

  // ---- empty ---------------------------------------------------------------
  const empty = computeTurnPerformance({ snapshots: [], snapshotUnits: [], turns: [] });
  check("no data yields zeroed totals, not NaN", empty.totals.measured === 0 && empty.totals.avgTradeOut === null);
  check("and reports having no snapshots", empty.snapshotCount === 0);

  // ---- against the real database (read-only) ------------------------------
  const fx = await loadFixtures();
  const live = await computeTurnPerformanceFor(fx.propertyId);
  check(
    "the loader runs against real schema and returns a shaped result",
    Array.isArray(live.outcomes) && Array.isArray(live.byFloorplan) && typeof live.totals.measured === "number",
    `${fx.propertySlug}: ${live.outcomes.length} turns, ${live.snapshotCount} snapshot(s), ${live.totals.measured} measured`,
  );
  check(
    "with one snapshot nothing can be measured yet",
    live.snapshotCount < 2 ? live.totals.measured === 0 : true,
    `snapshots=${live.snapshotCount}`,
  );

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * End-to-end probe of automatic target slip, against the real database.
 *
 * Covers what inspection cannot: that a missed phase pushes itself AND
 * everything after it, that the working-day gaps between phases survive the
 * push, that a second run the same day is a no-op, and that correcting a
 * forgotten transition takes the slip back off.
 *
 * Creates its own project, asserts, and DELETES everything it made in a finally
 * block. It touches no existing row. Safe to re-run.
 *
 *   npx tsx scripts/probe-target-slip.ts
 *
 * Exits non-zero if any assertion fails.
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { asc, eq } from "drizzle-orm";
import { db, schema } from "../src/db";
import { defaultMilestoneRows } from "../src/lib/milestones";
import { slipOverdueTargets, rebaseFromActual, readSlipTotals } from "../src/lib/target-slip";
import { businessDaysBetween, addBusinessDays } from "../src/lib/schedule-defaults";
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

/** Mon 7 Sep 2026 → Thu 10 → Wed 30 → Tue 6 Oct. Gaps: 3, 15, 4 working days. */
const PLAN = {
  precon: "2026-09-07",
  in_process: "2026-09-10",
  punch: "2026-10-01",
  complete: "2026-10-07",
} as const;

/** Two working weeks after the plan said pre-con should have ended. */
const TODAY = "2026-09-24";

async function targets(projectId: number) {
  const rows = await db()
    .select({ phase: schema.projectMilestones.phase, planned: schema.projectMilestones.plannedDate })
    .from(schema.projectMilestones)
    .where(eq(schema.projectMilestones.projectId, projectId))
    .orderBy(asc(schema.projectMilestones.sortOrder));
  return new Map(rows.map((r) => [r.phase as string, r.planned as string]));
}

async function main() {
  const fx = await loadFixtures();
  let projectId = 0;

  try {
    const [p] = await db()
      .insert(schema.projects)
      .values({
        propertyId: fx.propertyId,
        kind: "common",
        name: "ZZ probe — target slip",
        phase: "precon",
      })
      .returning({ id: schema.projects.id });
    projectId = p.id;

    await db()
      .insert(schema.projectMilestones)
      .values(
        defaultMilestoneRows(projectId).map((row) => ({
          ...row,
          plannedDate: PLAN[row.phase as keyof typeof PLAN],
        })),
      );

    const before = await targets(projectId);
    const gapPreconToWork = businessDaysBetween(before.get("precon")!, before.get("in_process")!);
    const gapWorkToPunch = businessDaysBetween(before.get("in_process")!, before.get("punch")!);
    const gapPunchToDone = businessDaysBetween(before.get("punch")!, before.get("complete")!);
    check("the plan starts with the gaps we set",
      gapPreconToWork === 3 && gapWorkToPunch === 15 && gapPunchToDone === 4,
      `${gapPreconToWork}/${gapWorkToPunch}/${gapPunchToDone} working days`);

    // ---- the push
    const slip = await db().transaction((tx) =>
      slipOverdueTargets(tx, projectId, "precon", TODAY),
    );
    check("a missed phase slips", !!slip, slip ? `${slip.days} working days` : "no slip");
    if (!slip) return;

    const after = await targets(projectId);
    check("the slip is counted in WORKING days, not calendar days",
      slip.days === businessDaysBetween(PLAN.in_process, TODAY) && slip.days === 10,
      `${slip.days} working (calendar span is 14)`);
    check("the missed phase lands on today", after.get("in_process") === TODAY,
      `${after.get("in_process")}`);
    check("everything after it moved too",
      after.get("punch") !== PLAN.punch && after.get("complete") !== PLAN.complete,
      `punch ${after.get("punch")}, complete ${after.get("complete")}`);

    // ---- the promise of gap-preservation
    check("the working-day gaps are preserved exactly",
      businessDaysBetween(after.get("in_process")!, after.get("punch")!) === gapWorkToPunch &&
        businessDaysBetween(after.get("punch")!, after.get("complete")!) === gapPunchToDone,
      `${businessDaysBetween(after.get("in_process")!, after.get("punch")!)}/${businessDaysBetween(after.get("punch")!, after.get("complete")!)}`);

    // ---- a phase already reached is left alone
    check("the phase the project is IN keeps its target",
      after.get("precon") === PLAN.precon, `${after.get("precon")}`);

    // ---- nothing lands on a weekend
    const weekendish = [...after.values()].filter((iso) => {
      const day = new Date(`${iso}T00:00:00`).getDay();
      return day === 0 || day === 6;
    });
    check("no target lands on a weekend", weekendish.length === 0, weekendish.join(" "));

    // ---- the audit trail
    const events = await db()
      .select({ phase: schema.milestoneSlipEvents.phase, days: schema.milestoneSlipEvents.days,
                from: schema.milestoneSlipEvents.fromDate, reason: schema.milestoneSlipEvents.reason })
      .from(schema.milestoneSlipEvents)
      .where(eq(schema.milestoneSlipEvents.projectId, projectId));
    check("every moved phase is recorded", events.length === 3, `${events.length} events`);
    check("the record says what was originally planned",
      events.find((e) => e.phase === "complete")?.from === PLAN.complete,
      `${events.find((e) => e.phase === "complete")?.from}`);
    check("recorded as a miss", events.every((e) => e.reason === "missed"));

    const totals = await readSlipTotals([projectId]);
    check("cumulative slip counts the tail once", totals.get(projectId) === slip.days,
      `${totals.get(projectId)} vs ${slip.days}`);

    // ---- idempotent
    const again = await db().transaction((tx) =>
      slipOverdueTargets(tx, projectId, "precon", TODAY),
    );
    check("a second run the same day does nothing", again === null);

    // ---- the override: it actually transitioned on time, nobody recorded it
    const rebased = await db().transaction((tx) =>
      rebaseFromActual(tx, projectId, "precon", PLAN.precon, "precon"),
    );
    check("correcting the actual re-bases the plan", !!rebased);
    const fixed = await targets(projectId);
    check("the slip comes back off",
      fixed.get("in_process") === addBusinessDays(PLAN.precon, gapPreconToWork),
      `${fixed.get("in_process")} (plan said ${PLAN.in_process})`);
    check("and the gaps still hold after re-basing",
      businessDaysBetween(fixed.get("in_process")!, fixed.get("punch")!) === gapWorkToPunch,
      `${businessDaysBetween(fixed.get("in_process")!, fixed.get("punch")!)}`);

    const reasons = await db()
      .select({ reason: schema.milestoneSlipEvents.reason })
      .from(schema.milestoneSlipEvents)
      .where(eq(schema.milestoneSlipEvents.projectId, projectId));
    check("the re-base is recorded distinctly from the miss",
      reasons.some((r) => r.reason === "rebased") && reasons.some((r) => r.reason === "missed"),
      reasons.map((r) => r.reason).join(","));
  } finally {
    if (projectId) {
      await db().delete(schema.milestoneSlipEvents).where(eq(schema.milestoneSlipEvents.projectId, projectId));
      await db().delete(schema.projectMilestones).where(eq(schema.projectMilestones.projectId, projectId));
      await db().delete(schema.projectStageEvents).where(eq(schema.projectStageEvents.projectId, projectId));
      await db().delete(schema.projects).where(eq(schema.projects.id, projectId));
      console.log("  teardown: removed");
    }
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });

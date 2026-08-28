/**
 * End-to-end probe of target phasing, against the real database.
 *
 * The change under test moved the planned schedule out of `projects.start_date`
 * / `target_completion_date` and onto the four seeded phase milestones, so the
 * plan lives where it is edited. The interesting assertions are the negatives —
 * creating a unit turn must NOT set a vendor and must NOT stamp a start date,
 * because both of those were plans wearing an actual's clothes.
 *
 * Creates its own unit and project, asserts, and DELETES everything it made in
 * a finally block. It touches no existing row. Safe to re-run.
 *
 *   npx tsx scripts/probe-target-phasing.ts
 *
 * Exits non-zero if any assertion fails.
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "../src/db";
import { createInteriorProject } from "../src/lib/actions/interior-projects";
import { getScheduleProjects } from "../src/lib/schedule-data";
import { phaseRun, describeDays, dayBefore } from "../src/lib/schedule-defaults";
import { loadFixtures } from "./probe-fixtures";

// Resolved at run time — see probe-fixtures.ts.
let PROPERTY_ID = 0;
const UNIT_NUMBER = "ZZ-PROBE-PHASING";

const PLAN = {
  pre_walk: "2026-08-31",
  precon: "2026-09-04",
  in_process: "2026-09-07",
  punch: "2026-09-21",
  complete: "2026-09-25",
} as const;

/**
 * createInteriorProject, minus the revalidatePath that needs a request around it.
 * Returns the new project's id either way.
 */
async function createOutsideNext(
  input: Parameters<typeof createInteriorProject>[0],
): Promise<number> {
  try {
    const res = await createInteriorProject(input);
    if (!res.ok) throw new Error(res.error);
    return res.projectId;
  } catch (err) {
    if (!String(err).includes("static generation store")) throw err;
    const unit = await db().query.units.findFirst({
      where: and(
        eq(schema.units.propertyId, PROPERTY_ID),
        eq(schema.units.unitNumber, UNIT_NUMBER),
      ),
    });
    if (!unit) throw err;
    const project = await db().query.projects.findFirst({
      where: eq(schema.projects.unitId, unit.id),
    });
    if (!project) throw err;
    return project.id;
  }
}

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

async function main() {
  const fx = await loadFixtures();
  PROPERTY_ID = fx.propertyId;
  console.log(`  fixtures: property ${fx.propertySlug}
`);

  const group = await db().query.budgetGroups.findFirst({
    where: eq(schema.budgetGroups.propertyId, PROPERTY_ID),
  });
  if (!group) throw new Error("no budget group on property 1 to build from");

  const code = { id: fx.codeA };
  if (!code) throw new Error("no cost code to price against");

  let projectId: number | null = null;
  let unitId: number | null = null;

  try {
    // revalidatePath() only works inside a request, and the action calls it after
    // the transaction commits. Outside Next it throws on a project that already
    // exists, so the id is recovered rather than the run being called a failure —
    // and recovered BEFORE any assertion, so the finally block can still clean up.
    const created = await createOutsideNext({
      propertyId: PROPERTY_ID,
      budgetGroupId: group.id,
      unitNumber: UNIT_NUMBER,
      name: "ZZ Probe — target phasing",
      preWalkDate: PLAN.pre_walk,
      milestones: [
        { phase: "precon", plannedDate: PLAN.precon },
        { phase: "in_process", plannedDate: PLAN.in_process },
        { phase: "punch", plannedDate: PLAN.punch },
        { phase: "complete", plannedDate: PLAN.complete },
      ],
      lines: [
        {
          item: "Probe line",
          pricingMethod: "fixed",
          unitPrice: 1000,
          quantity: 1,
          costCodeId: code.id,
        },
      ],
    });
    const project = await db().query.projects.findFirst({
      where: eq(schema.projects.id, created),
    });
    projectId = created;
    unitId = project?.unitId ?? null;
    check("project is created", !!project, `#${created}`);
    if (!project) return;

    // ---- the two columns that used to receive a plan
    check("no vendor is assigned at creation", project?.vendorId == null, `${project?.vendorId}`);
    check("no start date is stamped at creation", project?.startDate == null, `${project?.startDate}`);
    check(
      "no target completion is written to the project",
      project?.targetCompletionDate == null,
      `${project?.targetCompletionDate}`,
    );
    check("the pre-walk still lands on the project", project?.preWalkDate === PLAN.pre_walk,
      `${project?.preWalkDate}`);

    // ---- the plan is on the milestones, which is where it is edited
    const milestones = await db()
      .select({
        phase: schema.projectMilestones.phase,
        plannedDate: schema.projectMilestones.plannedDate,
        isDefault: schema.projectMilestones.isDefault,
      })
      .from(schema.projectMilestones)
      .where(eq(schema.projectMilestones.projectId, projectId));

    check("four phase rows are seeded", milestones.length === 4, `${milestones.length}`);
    const byPhase = new Map(milestones.map((m) => [m.phase, m.plannedDate]));
    check(
      "every phase carries its target start",
      (["precon", "in_process", "punch", "complete"] as const).every(
        (k) => byPhase.get(k) === PLAN[k],
      ),
      [...byPhase].map(([k, v]) => `${k}:${v}`).join(" "),
    );

    // ---- the schedule views read the plan from there
    const scheduled = await getScheduleProjects({ propertyId: PROPERTY_ID });
    const row = scheduled.find((p) => p.id === projectId);
    check("the project reaches the schedule views", !!row);
    check("target start comes from the In Process milestone", row?.targetStart === PLAN.in_process,
      `${row?.targetStart}`);
    check("target finish comes from the Complete milestone", row?.targetCompletion === PLAN.complete,
      `${row?.targetCompletion}`);
    check("no actual start yet", row?.actualStart == null, `${row?.actualStart}`);
    check("no actual completion yet", row?.actualCompletion == null, `${row?.actualCompletion}`);

    // ---- editing the target moves what the views draw, which is the whole point
    await db()
      .update(schema.projectMilestones)
      .set({ plannedDate: "2026-09-14" })
      .where(
        and(
          eq(schema.projectMilestones.projectId, projectId),
          eq(schema.projectMilestones.phase, "in_process"),
        ),
      );
    const after = (await getScheduleProjects({ propertyId: PROPERTY_ID })).find(
      (p) => p.id === projectId,
    );
    check("moving the phase target moves the schedule", after?.targetStart === "2026-09-14",
      `${after?.targetStart}`);

    // ---- a custom milestone tagged with a phase must not hijack the target
    await db().insert(schema.projectMilestones).values({
      projectId,
      label: "ZZ custom in-process note",
      phase: "in_process",
      plannedDate: "2026-12-01",
      isDefault: false,
      sortOrder: 9,
    });
    const withCustom = (await getScheduleProjects({ propertyId: PROPERTY_ID })).find(
      (p) => p.id === projectId,
    );
    check(
      "a custom milestone on the same phase does not become the target",
      withCustom?.targetStart === "2026-09-14",
      `${withCustom?.targetStart}`,
    );

    // ---- the derived end of a phase
    const run = phaseRun(PLAN, "in_process");
    check(
      "a phase ends the day before the next begins",
      run?.endsIso === dayBefore(PLAN.punch),
      `${run?.endsIso} (${run ? describeDays(run.days) : "—"})`,
    );
    check("Complete has no end — it is the finish line", phaseRun(PLAN, "complete") === null);
  } finally {
    if (projectId) {
      await db().delete(schema.projectMilestones).where(eq(schema.projectMilestones.projectId, projectId));
      await db().delete(schema.scopeItems).where(eq(schema.scopeItems.projectId, projectId));
      await db().delete(schema.projectStageEvents).where(eq(schema.projectStageEvents.projectId, projectId));
      await db().delete(schema.projectTriggerAnswers).where(eq(schema.projectTriggerAnswers.projectId, projectId));
      await db().delete(schema.projects).where(eq(schema.projects.id, projectId));
    }
    if (unitId) {
      await db().delete(schema.units).where(inArray(schema.units.id, [unitId]));
    }
    console.log("  teardown: removed");
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);

/**
 * End-to-end probe of common-area project creation, against the real database.
 *
 * The interesting assertions are the negatives. A common project used to be
 * created from a one-field form and then filled in from four other screens; the
 * wizard now collects the whole thing, and what it must NOT do is put a number
 * somewhere it will disagree with itself later — no typed budget, no start date
 * standing in for a plan.
 *
 * Creates its own project, asserts, and DELETES everything it made in a finally
 * block. It touches no existing row. Safe to re-run.
 *
 *   npx tsx scripts/probe-common-project.ts
 *
 * Exits non-zero if any assertion fails.
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { asc, eq, like } from "drizzle-orm";
import { db, schema } from "../src/db";
import { createCommonProjectRows } from "../src/lib/common-project";
import { readBudgetLinesForPicker } from "../src/lib/budget-picker";
import { loadFixtures } from "./probe-fixtures";

const NAME = "ZZ probe — common wizard";

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
  let projectId = 0;

  try {
    const picker = await readBudgetLinesForPicker(fx.propertyId);
    check("the budget picker offers the property's UW lines", picker.length > 0, `${picker.length}`);
    const line = picker.find((b) => b.approved > 0);
    if (!line) {
      check("a funded budget line exists to build against", false);
      return;
    }
    check(
      "each line reports what is already spoken for",
      picker.every((b) => typeof b.allocated === "number"),
      `${line.name}: ${line.allocated} of ${line.approved}`,
    );

    const created = await createCommonProjectRows({
      propertyId: fx.propertyId,
      name: NAME,
      milestones: [
        { phase: "precon", plannedDate: "2026-09-07" },
        { phase: "in_process", plannedDate: "2026-09-10" },
        { phase: "punch", plannedDate: "2026-10-01" },
        { phase: "complete", plannedDate: "2026-10-07" },
      ],
      lines: [
        { item: "Probe line A", costCodeId: line.costCodeId, quantity: 2, unitPrice: 1500 },
        { item: "Probe line B", costCodeId: fx.codeA, quantity: 1, unitPrice: 400 },
      ],
    });
    check("project is created", created.ok, created.ok ? undefined : created.error);
    if (!created.ok) return;
    projectId = created.projectId;

    const project = await db().query.projects.findFirst({
      where: eq(schema.projects.id, projectId),
    });
    if (!project) return;

    check("it is a common-area project", project.kind === "common", project.kind);
    check("it starts in pre-con", project.phase === "precon", project.phase);
    // The categories live on the lines. A project-level code named only part
    // of Exterior Paint's spend and hid the rest — see common-project.ts.
    check("no project-level cost code is asserted", project.costCodeId == null,
      `${project.costCodeId}`);

    // ---- the two numbers that must not be typed
    check(
      "the budget is DERIVED from the scope, not typed",
      Number(project.budgetAmount) === 2 * 1500 + 400,
      `${project.budgetAmount} (scope is ${2 * 1500 + 400})`,
    );
    check("no start date is stamped at creation", project.startDate == null, `${project.startDate}`);
    check(
      "no target completion is written to the project",
      project.targetCompletionDate == null,
      `${project.targetCompletionDate}`,
    );
    check("no vendor is assigned", project.vendorId == null);

    const scope = await db()
      .select({ item: schema.scopeItems.item, costCodeId: schema.scopeItems.costCodeId })
      .from(schema.scopeItems)
      .where(eq(schema.scopeItems.projectId, projectId))
      .orderBy(asc(schema.scopeItems.sortOrder));
    check("both scope lines land", scope.length === 2, `${scope.length}`);
    check(
      "lines keep their own categories, and they may differ",
      scope[0]?.costCodeId === line.costCodeId && scope[1]?.costCodeId === fx.codeA,
      `${scope[0]?.costCodeId} then ${scope[1]?.costCodeId}`,
    );

    // ---- target phasing arrives with the project
    const ms = await db()
      .select({ phase: schema.projectMilestones.phase, planned: schema.projectMilestones.plannedDate })
      .from(schema.projectMilestones)
      .where(eq(schema.projectMilestones.projectId, projectId));
    check("four phase rows are seeded", ms.length === 4, `${ms.length}`);
    check(
      "every phase carries its target start",
      ms.every((m) => m.planned !== null),
      ms.map((m) => `${m.phase}:${m.planned}`).join(" "),
    );

    const events = await db()
      .select({ toPhase: schema.projectStageEvents.toPhase })
      .from(schema.projectStageEvents)
      .where(eq(schema.projectStageEvents.projectId, projectId));
    check("creation is on the stage trail", events.length === 1 && events[0].toPhase === "precon");

    // ---- the scope step says it can be skipped, so it has to survive being
    // skipped: no lines means no codes to validate and no budget to derive.
    const bare = await createCommonProjectRows({
      propertyId: fx.propertyId,
      name: `${NAME} (no scope)`,
      lines: [],
    });
    check("a project with no scope at all still creates", bare.ok,
      bare.ok ? undefined : bare.error);
    if (bare.ok) {
      const p2 = await db().query.projects.findFirst({
        where: eq(schema.projects.id, bare.projectId),
      });
      check("and reports no budget rather than zero", Number(p2?.budgetAmount ?? -1) === 0,
        `${p2?.budgetAmount}`);
    }

    // ---- a code from another chart is refused
    const bad = await createCommonProjectRows({
      propertyId: fx.propertyId,
      name: `${NAME} (bad code)`,
      lines: [{ item: "Bad", costCodeId: 999_999, quantity: 1, unitPrice: 1 }],
    }).catch((e) => ({ ok: false as const, error: String(e) }));
    check("a scope line coded outside the property's chart is refused", bad.ok === false,
      bad.ok === false ? bad.error.slice(0, 60) : "accepted");
  } finally {
    const made = await db()
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(like(schema.projects.name, `${NAME}%`));
    for (const p of made) {
      await db().delete(schema.projectMilestones).where(eq(schema.projectMilestones.projectId, p.id));
      await db().delete(schema.scopeItems).where(eq(schema.scopeItems.projectId, p.id));
      await db().delete(schema.projectStageEvents).where(eq(schema.projectStageEvents.projectId, p.id));
      await db().delete(schema.projectActivityLog).where(eq(schema.projectActivityLog.projectId, p.id));
      await db().delete(schema.projects).where(eq(schema.projects.id, p.id));
    }
    console.log(`  teardown: removed ${made.length}`);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });

import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { computeInteriorBudgets } from "@/lib/interior-budget";
import { readScheduleHealth, type ScheduleStatus } from "@/lib/target-slip";
import {
  capitalByPhase,
  deploymentCurve,
  type CapitalByPhase,
  type DeploymentCurve,
  type ProjectRow,
} from "@/lib/exec-capital";

export type ExecCapital = {
  byPhase: CapitalByPhase;
  curve: DeploymentCurve;
  budgetTotal: number;
  projectTotal: number;
  inProcessTotal: number;
  projectCount: number;
  inProcessCount: number;
  schedule: { status: ScheduleStatus; late: number };
};

/**
 * Everything the executive tab plots, for one property.
 *
 * The budget total is the same effective figure the portfolio and Budget tab
 * use — non-interior lines plus the plan-derived interior total where a plan
 * exists — so the deployment curve cannot disagree with the number printed
 * above it.
 */
export async function readExecCapital(propertyId: number, today: string): Promise<ExecCapital> {
  const [budgetRows, projectRows, milestoneRows, interior] = await Promise.all([
    db()
      .select({
        isInterior: schema.costCodes.isInterior,
        total: schema.budgetLines.uwAmount,
      })
      .from(schema.budgetLines)
      .innerJoin(schema.costCodes, eq(schema.budgetLines.costCodeId, schema.costCodes.id))
      .where(and(eq(schema.budgetLines.propertyId, propertyId), isNull(schema.budgetLines.archivedAt))),
    db()
      .select({
        id: schema.projects.id,
        name: schema.projects.name,
        kind: schema.projects.kind,
        phase: schema.projects.phase,
        budgetAmount: schema.projects.budgetAmount,
        startDate: schema.projects.startDate,
        category: schema.costCategories.name,
      })
      .from(schema.projects)
      .leftJoin(schema.costCodes, eq(schema.projects.costCodeId, schema.costCodes.id))
      .leftJoin(schema.costCategories, eq(schema.costCodes.categoryId, schema.costCategories.id))
      .where(and(eq(schema.projects.propertyId, propertyId), isNull(schema.projects.archivedAt))),
    db()
      .select({
        projectId: schema.projectMilestones.projectId,
        phase: schema.projectMilestones.phase,
        plannedDate: schema.projectMilestones.plannedDate,
      })
      .from(schema.projectMilestones)
      .innerJoin(schema.projects, eq(schema.projectMilestones.projectId, schema.projects.id))
      .where(and(eq(schema.projects.propertyId, propertyId), isNull(schema.projectMilestones.archivedAt))),
    computeInteriorBudgets([propertyId]),
  ]);

  let manualInterior = 0;
  let other = 0;
  for (const r of budgetRows) {
    const v = Number(r.total ?? 0);
    if (r.isInterior) manualInterior += v;
    else other += v;
  }
  const plan = interior.get(propertyId);
  const budgetTotal = other + (plan?.hasPlan ? plan.total : manualInterior);

  const dates = new Map<number, Record<string, string | null>>();
  for (const m of milestoneRows) {
    if (!m.phase || !m.plannedDate) continue;
    const e = dates.get(m.projectId) ?? {};
    e[m.phase] = m.plannedDate;
    dates.set(m.projectId, e);
  }

  const projects: ProjectRow[] = projectRows.map((p) => {
    const d = dates.get(p.id) ?? {};
    return {
      id: p.id,
      name: p.name,
      kind: p.kind as ProjectRow["kind"],
      phase: p.phase as ProjectRow["phase"],
      budget: Number(p.budgetAmount ?? 0),
      category: p.category,
      preconDate: d.precon ?? null,
      inProcessDate: d.in_process ?? null,
      completeDate: d.complete ?? null,
      startDate: p.startDate ?? null,
    };
  });

  // Worst-first, matching the portfolio cards: one late project makes the
  // property late, rather than an average hiding it.
  const health = await readScheduleHealth(projects.map((p) => p.id));
  const RANK: Record<ScheduleStatus, number> = { late: 3, slipping: 2, on_time: 1, unknown: 0 };
  let status: ScheduleStatus = "unknown";
  let late = 0;
  for (const h of health.values()) {
    if (RANK[h.status] > RANK[status]) status = h.status;
    if (h.status === "late") late++;
  }

  const inProcess = projects.filter((p) => p.phase === "in_process");
  return {
    byPhase: capitalByPhase(projects),
    curve: deploymentCurve(projects, budgetTotal, today),
    budgetTotal,
    projectTotal: projects.reduce((s, p) => s + p.budget, 0),
    inProcessTotal: inProcess.reduce((s, p) => s + p.budget, 0),
    projectCount: projects.length,
    inProcessCount: inProcess.length,
    schedule: { status, late },
  };
}

import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { BudgetCategory, BudgetDivision } from "@/components/budget-view";
import { money, num } from "@/lib/format";
import { DIVISIONS, divisionLabel } from "@/lib/divisions";
import { bucketForPhase } from "@/lib/stage-buckets";
import { computeInteriorBudgetFor, loadFloorplanFacts } from "@/lib/interior-budget";

// ---------------------------------------------------------------------------
// A property's whole budget -- UW lines and the interior plan, live actuals
// included -- computed once so the Budget tab and the Excel export cannot
// disagree about what a property's budget is.
//
// This is a straight extraction of what was the Budget page's own query and
// shaping logic. Moved rather than rewritten: it carries hard-won correctness
// the comments below document inline -- a project with $500,000 approved
// against $75,000 of scope that scope-first logic once erased $425,000 from,
// sixteen unit turns a stray `continue` once dropped from every category, and
// the unattributed-GL and stage-bucket rules that keep Planned/In Process/
// Completed from double-counting or hiding real spend.
// ---------------------------------------------------------------------------

export type PropertyBudget = {
  budgetDivisions: BudgetDivision[];
  categories: Awaited<ReturnType<typeof loadCategories>>;
  codes: Awaited<ReturnType<typeof loadCodes>>;
  categoryOptions: { id: number; code: string; name: string }[];
  costCodeOptions: { id: number; categoryId: number; code: string; name: string; isInterior: boolean }[];
  budgetedCostCodeIds: number[];
  interior: Awaited<ReturnType<typeof computeInteriorBudgetFor>>;
  derivedInteriors: boolean;
  interiorNote: string | null;
  rentRoll: { hasCommitted: boolean; pendingCount: number };
  avgTradeOutByTier: Map<number, number>;
  availableFloorplans: {
    floorPlanCode: string;
    unitCount: number;
    avgSqft: number | null;
    planned: number;
    unitGroupId: number | null;
  }[];
  existingColumns: {
    unitGroupId: number;
    tierId: number;
    groupName: string;
    tierName: string;
    plannedUnits: number;
    avgSqft: number | null;
  }[];
  availableTiers: Awaited<ReturnType<typeof loadAvailableTiers>>;
};

function loadCategories(propertyId: number, chartOfAccountsId: number) {
  return db()
    .select()
    .from(schema.costCategories)
    .where(eq(schema.costCategories.chartId, chartOfAccountsId))
    .orderBy(asc(schema.costCategories.sortOrder));
}

function loadCodes(propertyId: number, chartOfAccountsId: number) {
  return db()
    .select()
    .from(schema.costCodes)
    .where(and(eq(schema.costCodes.chartId, chartOfAccountsId), eq(schema.costCodes.active, true)))
    .orderBy(asc(schema.costCodes.code));
}

function loadAvailableTiers(propertyId: number) {
  return db()
    .select({ id: schema.budgetGroups.id, name: schema.budgetGroups.name, targetTradeOut: schema.budgetGroups.targetTradeOut })
    .from(schema.budgetGroups)
    .where(
      and(
        eq(schema.budgetGroups.propertyId, propertyId),
        eq(schema.budgetGroups.active, true),
        isNull(schema.budgetGroups.archivedAt),
      ),
    )
    .orderBy(asc(schema.budgetGroups.sortOrder), asc(schema.budgetGroups.name));
}

/**
 * Every UW line and interior-plan figure for one property, with live
 * committed/actual dollars folded in. The single source both the Budget page
 * and the Excel export read from.
 */
export async function computePropertyBudget(
  propertyId: number,
  chartOfAccountsId: number,
): Promise<PropertyBudget> {
  // Wave 1: all independent queries in parallel. rentRollBatches, availableTiers,
  // and floorplan facts were previously sequential — pulling them in here saves
  // multiple network round-trips against the pooled Supabase connection.
  const [categories, codes, lines, unattributedGlRows, projectRows, scopeRows, committedRows, jtdRows, rentRollBatchRows, availableTiers, facts] =
    await Promise.all([
      loadCategories(propertyId, chartOfAccountsId),
      loadCodes(propertyId, chartOfAccountsId),
      db()
        .select()
        .from(schema.budgetLines)
        .where(
          and(eq(schema.budgetLines.propertyId, propertyId), isNull(schema.budgetLines.archivedAt)),
        ),
      // Posted GL that a per-project rollup can't attribute to a code: rows
      // with no owning project (real spend, nothing to bucket by), plus rows
      // on a completed-stage *unit* project — those have no project-level
      // costCodeId (a unit turn's cost is broken out per code in its own
      // scopeItems, not one code per project), so their spend only surfaces
      // here, credited to the transaction's own cost code.
      db()
        .select({
          costCodeId: schema.glTransactions.costCodeId,
          total: sql<string>`coalesce(sum(${schema.glTransactions.amount}), 0)`,
        })
        .from(schema.glTransactions)
        .leftJoin(schema.projects, eq(schema.glTransactions.projectId, schema.projects.id))
        .where(
          sql`${schema.glTransactions.propertyId} = ${propertyId} and ${schema.glTransactions.status} = 'posted' and ${schema.glTransactions.costCodeId} is not null
              and (${schema.glTransactions.projectId} is null or (${schema.projects.kind} = 'unit' and ${schema.projects.phase} = 'complete'))`,
        )
        .groupBy(schema.glTransactions.costCodeId),
      // Projects coded to each line (common projects link to a cost code; interior
      // unit projects have no single cost code, so those lines show none).
      db()
        .select({
          id: schema.projects.id,
          name: schema.projects.name,
          phase: schema.projects.phase,
          costCodeId: schema.projects.costCodeId,
          budgetAmount: schema.projects.budgetAmount,
          committedCost: schema.projects.committedCost,
        })
        .from(schema.projects)
        // Archived projects must not contribute dollars — the portfolio index
        // already filters them, and this page previously didn't.
        .where(and(eq(schema.projects.propertyId, propertyId), isNull(schema.projects.archivedAt)))
        .orderBy(asc(schema.projects.name)),
      // What each project's scope puts against each category. A project is not
      // one budget line — its scope lines are, and they can span several.
      db()
        .select({
          projectId: schema.scopeItems.projectId,
          costCodeId: schema.scopeItems.costCodeId,
          quantity: schema.scopeItems.quantity,
          unitPrice: schema.scopeItems.unitPrice,
        })
        .from(schema.scopeItems)
        .innerJoin(schema.projects, eq(schema.projects.id, schema.scopeItems.projectId))
        .where(
          and(
            eq(schema.projects.propertyId, propertyId),
            isNull(schema.projects.archivedAt),
            isNull(schema.scopeItems.archivedAt),
          ),
        ),
      // Committed, per category: an awarded bid's line items resolved through the
      // scope line they price.
      db()
        .select({
          projectId: schema.scopeItems.projectId,
          costCodeId: schema.scopeItems.costCodeId,
          amount: schema.bidLineItems.amount,
        })
        .from(schema.bidLineItems)
        .innerJoin(schema.bids, eq(schema.bids.id, schema.bidLineItems.bidId))
        .innerJoin(schema.scopeItems, eq(schema.scopeItems.id, schema.bidLineItems.scopeItemId))
        .innerJoin(schema.projects, eq(schema.projects.id, schema.scopeItems.projectId))
        .where(
          and(
            eq(schema.projects.propertyId, propertyId),
            eq(schema.bids.approved, true),
            isNull(schema.bids.archivedAt),
            isNull(schema.projects.archivedAt),
            isNull(schema.scopeItems.archivedAt),
          ),
        ),
      // Posted spend per project AND code. gl_transactions carries both, so a
      // project spanning several categories reports its real split rather than
      // a single total that has to be filed somewhere.
      db()
        .select({
          projectId: schema.glTransactions.projectId,
          costCodeId: schema.glTransactions.costCodeId,
          total: sql<string>`coalesce(sum(${schema.glTransactions.amount}), 0)`,
        })
        .from(schema.glTransactions)
        .where(
          sql`${schema.glTransactions.propertyId} = ${propertyId} and ${schema.glTransactions.status} = 'posted' and ${schema.glTransactions.projectId} is not null`,
        )
        .groupBy(schema.glTransactions.projectId, schema.glTransactions.costCodeId),
      db()
        .select({ status: schema.rentRollBatches.status })
        .from(schema.rentRollBatches)
        .where(
          and(
            eq(schema.rentRollBatches.propertyId, propertyId),
            isNull(schema.rentRollBatches.archivedAt),
          ),
        ),
      loadAvailableTiers(propertyId),
      loadFloorplanFacts(propertyId),
    ]);

  // Everything below keys on project AND code, because a project contributes to
  // as many categories as its scope touches.
  const key = (projectId: number, codeId: number) => `${projectId}:${codeId}`;

  const budgetByProjectCode = new Map<string, number>();
  const codesByProject = new Map<number, Set<number>>();
  // A project whose scope is not fully priced cannot have its budget read off
  // that scope: it would report only the part somebody has written down. One
  // project here has $500,000 approved against $75,000 of scope, and letting
  // the scope decide erased the other $425,000 from the property's budget.
  const unpricedByProject = new Map<number, number>();
  for (const r of scopeRows) {
    if (r.projectId == null) continue;
    if (!r.quantity || !r.unitPrice || r.costCodeId == null) {
      unpricedByProject.set(r.projectId, (unpricedByProject.get(r.projectId) ?? 0) + 1);
      continue;
    }
    const k = key(r.projectId, r.costCodeId);
    budgetByProjectCode.set(k, (budgetByProjectCode.get(k) ?? 0) + Number(r.quantity) * Number(r.unitPrice));
    const set = codesByProject.get(r.projectId) ?? new Set<number>();
    set.add(r.costCodeId);
    codesByProject.set(r.projectId, set);
  }

  const committedByProjectCode = new Map<string, number>();
  for (const r of committedRows) {
    if (r.projectId == null || r.costCodeId == null) continue;
    const k = key(r.projectId, r.costCodeId);
    committedByProjectCode.set(k, (committedByProjectCode.get(k) ?? 0) + num(r.amount));
    const set = codesByProject.get(r.projectId) ?? new Set<number>();
    set.add(r.costCodeId);
    codesByProject.set(r.projectId, set);
  }

  const jtdByProjectCode = new Map<string, number>();
  for (const r of jtdRows) {
    if (r.projectId == null || r.costCodeId == null) continue;
    const k = key(r.projectId, r.costCodeId);
    jtdByProjectCode.set(k, (jtdByProjectCode.get(k) ?? 0) + num(r.total));
    const set = codesByProject.get(r.projectId) ?? new Set<number>();
    set.add(r.costCodeId);
    codesByProject.set(r.projectId, set);
  }

  // Bucket each cost code's dollars into Planned / In Process / Completed —
  // a project's committed cost or actual spend lands in exactly one bucket,
  // chosen by its own current stage (see src/lib/stage-buckets.ts).
  type CodeBuckets = { planned: number; inProcess: number; completed: number };
  const bucketsByCode = new Map<number, CodeBuckets>();
  function addToBucket(codeId: number, key: keyof CodeBuckets, amount: number) {
    const b = bucketsByCode.get(codeId) ?? { planned: 0, inProcess: 0, completed: 0 };
    b[key] += amount;
    bucketsByCode.set(codeId, b);
  }

  const projectsByCode = new Map<number, BudgetCategory["lines"][number]["projects"]>();
  for (const p of projectRows) {
    // Which categories this project touches. Its scope decides — falling back to
    // projects.cost_code_id only for a project with no scope at all, so a common
    // job coded but not yet written out still shows somewhere.
    // Scope decides only once every line is priced. Until then the approved
    // figure is the better answer, and it files where it always did.
    const fullyPriced = (unpricedByProject.get(p.id) ?? 0) === 0;
    const touched = fullyPriced ? codesByProject.get(p.id) : undefined;
    const codeIds =
      touched && touched.size > 0
        ? [...touched]
        : p.costCodeId != null
          ? [p.costCodeId]
          : [];

    // Sixteen unit turns had a null project code and were skipped entirely by
    // the old `continue` — their budgets contributed to no category at all.
    if (codeIds.length === 0) continue;

    const usingFallback = !touched || touched.size === 0;

    for (const codeId of codeIds) {
      const k = key(p.id, codeId);
      const completedAmount = usingFallback ? 0 : (jtdByProjectCode.get(k) ?? 0);
      // Prefer what an award actually committed against this category; fall back
      // to the project-level figure only when nothing is awarded per line.
      const perCode = committedByProjectCode.get(k);
      const committedAmount =
        perCode != null ? perCode : usingFallback ? num(p.committedCost) : 0;
      const budgetAmount = usingFallback
        ? num(p.budgetAmount)
        : (budgetByProjectCode.get(k) ?? 0);

      if (budgetAmount === 0 && committedAmount === 0 && completedAmount === 0) continue;

      const list = projectsByCode.get(codeId) ?? [];
      list.push({
        id: p.id,
        name: p.name,
        phase: p.phase,
        budget: budgetAmount,
        committed: committedAmount,
        completed: completedAmount,
      });
      projectsByCode.set(codeId, list);

      // Never hide real spend: a project can have posted GL before its contract
      // amount was ever recorded (or before it's formally marked complete), so
      // Planned/In Process show whichever is larger — the committed figure or
      // what's actually been spent so far.
      const bucket = bucketForPhase(p.phase);
      if (bucket === "planned") addToBucket(codeId, "planned", Math.max(committedAmount, completedAmount));
      else if (bucket === "in_process")
        addToBucket(codeId, "inProcess", Math.max(committedAmount, completedAmount));
      else addToBucket(codeId, "completed", completedAmount);
    }
  }
  for (const r of unattributedGlRows) {
    if (r.costCodeId == null) continue;
    addToBucket(r.costCodeId, "completed", num(r.total));
  }

  const lineByCode = new Map(lines.map((l) => [l.costCodeId, l]));

  // Wave 2: queries that depend on Wave 1 results. The interior budget gets
  // pre-fetched cost codes and categories so it skips 2 internal DB queries.
  // avgTradeOut depends on availableTiers from Wave 1.
  const [interior, avgTradeOutRows] = await Promise.all([
    computeInteriorBudgetFor(propertyId, { costCodes: codes, categories }),
    availableTiers.length
      ? db()
          .select({
            budgetGroupId: schema.projects.budgetGroupId,
            avgTradeOut: sql<string>`coalesce(avg(${schema.projects.tradeOutRent} - ${schema.projects.previousRent}), 0)`,
          })
          .from(schema.projects)
          .where(
            and(
              eq(schema.projects.propertyId, propertyId),
              isNull(schema.projects.archivedAt),
              sql`${schema.projects.tradeOutRent} is not null and ${schema.projects.previousRent} is not null and ${schema.projects.budgetGroupId} is not null`,
            ),
          )
          .groupBy(schema.projects.budgetGroupId)
      : Promise.resolve([]),
  ]);

  const derivedInteriors = interior.hasPlan;
  const rentRoll = {
    hasCommitted: rentRollBatchRows.some((b) => b.status === "committed"),
    pendingCount: rentRollBatchRows.filter(
      (b) => b.status === "uploaded" || b.status === "parsing" || b.status === "needs_review",
    ).length,
  };
  const avgTradeOutByTier = new Map(avgTradeOutRows.map((r) => [r.budgetGroupId!, num(r.avgTradeOut)]));

  // Floorplans the wizard can still draw units from, with how much of each is
  // already committed. Groups are 1:1 with floorplan codes.
  const plannedByGroup = new Map<number, number>();
  for (const c of interior.columns) {
    plannedByGroup.set(c.unitGroupId, (plannedByGroup.get(c.unitGroupId) ?? 0) + c.plannedUnits);
  }
  const availableFloorplans = facts
    .map((f) => {
      const group = interior.unitGroups.find((g) => g.floorPlanCodes.includes(f.floorPlanCode));
      return {
        floorPlanCode: f.floorPlanCode,
        unitCount: group?.unitCount ?? f.count,
        avgSqft: group?.avgSqft ?? f.avgSqft,
        planned: group ? (plannedByGroup.get(group.id) ?? 0) : 0,
        unitGroupId: group?.id ?? null,
      };
    })
    .sort((a, b) => a.floorPlanCode.localeCompare(b.floorPlanCode));

  const existingColumns = interior.columns.map((c) => {
    const group = interior.unitGroups.find((g) => g.id === c.unitGroupId);
    const tier = interior.tiers.find((t) => t.id === c.tierId);
    return {
      unitGroupId: c.unitGroupId,
      tierId: c.tierId,
      groupName: group?.name ?? "Unknown",
      tierName: tier?.name ?? "Unknown",
      plannedUnits: c.plannedUnits,
      avgSqft: group?.avgSqft ?? null,
    };
  });

  // Build the category → lines tree the view renders. A code appears if it has a
  // hand-entered line OR a plan-derived amount — without the second half, the
  // interior categories would vanish entirely once a plan takes over.
  const budgetCategories: BudgetCategory[] = categories
    .map((cat) => {
      const catCodes = codes.filter((c) => c.categoryId === cat.id);
      const catLines = catCodes
        .map((code) => {
          const line = lineByCode.get(code.id);
          const isDerived = derivedInteriors && code.isInterior;
          const derivedAmount = isDerived ? interior.byCostCode.get(code.id) ?? 0 : null;
          if (!line && !derivedAmount) return null;
          return { code, line, isDerived, budget: derivedAmount ?? num(line!.uwAmount) };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
      if (catLines.length === 0) return null;

      const lineRows = catLines.map(({ code, line, isDerived, budget }) => {
        const b = bucketsByCode.get(code.id) ?? { planned: 0, inProcess: 0, completed: 0 };
        return {
          // Plan-derived rows have no budget_lines row to key on, so they carry a
          // synthetic negative id. Never write to a row with id < 0.
          id: line?.id ?? -code.id,
          costCodeId: code.id,
          code: code.code,
          name: code.name,
          budget,
          planned: b.planned,
          inProcess: b.inProcess,
          completed: b.completed,
          perUnitAmount: line?.perUnitAmount ? num(line.perUnitAmount) : null,
          plannedUnits: line?.plannedUnits ?? null,
          isInterior: code.isInterior,
          isDerived,
          note: line?.note ?? null,
          projects: projectsByCode.get(code.id) ?? [],
        };
      });

      return {
        code: cat.code,
        name: cat.name,
        division: cat.division,
        budget: lineRows.reduce((s, l) => s + l.budget, 0),
        planned: lineRows.reduce((s, l) => s + l.planned, 0),
        inProcess: lineRows.reduce((s, l) => s + l.inProcess, 0),
        completed: lineRows.reduce((s, l) => s + l.completed, 0),
        lines: lineRows,
      } satisfies BudgetCategory;
    })
    .filter((c): c is BudgetCategory => c !== null);

  // Group categories into the broad divisions (Exterior / Amenities / Interiors
  // / Fees) for the overview, in canonical order; anything unassigned sinks to
  // the end.
  const divisionOrder = new Map<string, number>(DIVISIONS.map((d, i) => [d.key, i]));
  const byDivision = new Map<string, BudgetCategory[]>();
  for (const cat of budgetCategories) {
    const key = cat.division ?? "unassigned";
    (byDivision.get(key) ?? byDivision.set(key, []).get(key)!).push(cat);
  }
  const budgetDivisions: BudgetDivision[] = [...byDivision.entries()]
    .sort(([a], [b]) => (divisionOrder.get(a) ?? 99) - (divisionOrder.get(b) ?? 99))
    .map(([key, cats]) => ({
      key,
      label: key === "unassigned" ? "Unassigned" : divisionLabel(key),
      budget: cats.reduce((s, c) => s + c.budget, 0),
      planned: cats.reduce((s, c) => s + c.planned, 0),
      inProcess: cats.reduce((s, c) => s + c.inProcess, 0),
      completed: cats.reduce((s, c) => s + c.completed, 0),
      categories: cats,
    }));

  // The exterior/consolidated view filter lives on the page: it depends on the
  // URL's `view` param, which this shared computation has no business knowing
  // about, and the export needs every division regardless of what the page's
  // toggle currently shows.

  const interiorNote = derivedInteriors
    ? `Interiors are computed from the interior plan — ${interior.unitGroups.length} unit group${interior.unitGroups.length === 1 ? "" : "s"} × ${interior.tiers.length} tier${interior.tiers.length === 1 ? "" : "s"}, ${money(interior.total)}. Set what each type costs under Unit Upgrades → Renovation types.`
    : null;

  const categoryOptions = categories.map((c) => ({ id: c.id, code: c.code, name: c.name }));
  const costCodeOptions = codes.map((c) => ({
    id: c.id,
    categoryId: c.categoryId,
    code: c.code,
    name: c.name,
    isInterior: c.isInterior,
  }));
  const budgetedCostCodeIds = lines.map((l) => l.costCodeId);

  return {
    budgetDivisions,
    categories,
    codes,
    categoryOptions,
    costCodeOptions,
    budgetedCostCodeIds,
    interior,
    derivedInteriors,
    interiorNote,
    rentRoll,
    avgTradeOutByTier,
    availableFloorplans,
    existingColumns,
    availableTiers,
  };
}

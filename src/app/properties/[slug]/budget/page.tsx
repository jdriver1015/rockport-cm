import { notFound } from "next/navigation";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { PropertyHeader } from "@/components/property-header";
import { PropertyNav } from "@/components/property-nav";
import { BudgetView, type BudgetCategory, type BudgetDivision } from "@/components/budget-view";
import { AddBudgetLineDialog } from "@/components/add-budget-line-dialog";
import { BudgetViewSwitch } from "@/components/budget-view-switch";
import { parseBudgetView } from "@/lib/budget-views";
import { InteriorBudgetPivot } from "@/components/interior-budget-pivot";
import { InteriorBudgetToolbar } from "@/components/interior-budget-toolbar";
import { money, num } from "@/lib/format";
import { DIVISIONS, divisionLabel } from "@/lib/divisions";
import { bucketForPhase } from "@/lib/stage-buckets";
import { computeInteriorBudgetFor, loadFloorplanFacts } from "@/lib/interior-budget";

export const dynamic = "force-dynamic";

export default async function BudgetPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { slug } = await params;
  const view = parseBudgetView((await searchParams).view);

  const property = await db().query.properties.findFirst({
    where: eq(schema.properties.slug, slug),
  });
  if (!property) notFound();
  const propertyId = property.id;

  // A property's chart of accounts is fixed at creation. Every budget line, cost
  // code and GL transaction hangs off it, so switching it would invalidate all of
  // them — there is deliberately no way to change it here.

  // Wave 1: all independent queries in parallel. rentRollBatches, availableTiers,
  // and floorplan facts were previously sequential — pulling them in here saves
  // multiple network round-trips against the pooled Supabase connection.
  const [categories, codes, lines, unattributedGlRows, projectRows, jtdRows, rentRollBatchRows, availableTiers, facts] =
    await Promise.all([
      db()
        .select()
        .from(schema.costCategories)
        .where(eq(schema.costCategories.chartId, property.chartOfAccountsId))
        .orderBy(asc(schema.costCategories.sortOrder)),
      db()
        .select()
        .from(schema.costCodes)
        .where(and(eq(schema.costCodes.chartId, property.chartOfAccountsId), eq(schema.costCodes.active, true)))
        .orderBy(asc(schema.costCodes.code)),
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
      db()
        .select({
          projectId: schema.glTransactions.projectId,
          total: sql<string>`coalesce(sum(${schema.glTransactions.amount}), 0)`,
        })
        .from(schema.glTransactions)
        .where(
          sql`${schema.glTransactions.propertyId} = ${propertyId} and ${schema.glTransactions.status} = 'posted' and ${schema.glTransactions.projectId} is not null`,
        )
        .groupBy(schema.glTransactions.projectId),
      db()
        .select({ status: schema.rentRollBatches.status })
        .from(schema.rentRollBatches)
        .where(
          and(
            eq(schema.rentRollBatches.propertyId, propertyId),
            isNull(schema.rentRollBatches.archivedAt),
          ),
        ),
      db()
        .select({ id: schema.budgetGroups.id, name: schema.budgetGroups.name, targetTradeOut: schema.budgetGroups.targetTradeOut })
        .from(schema.budgetGroups)
        .where(
          and(
            eq(schema.budgetGroups.propertyId, propertyId),
            eq(schema.budgetGroups.active, true),
            isNull(schema.budgetGroups.archivedAt),
          ),
        )
        .orderBy(asc(schema.budgetGroups.sortOrder), asc(schema.budgetGroups.name)),
      loadFloorplanFacts(propertyId),
    ]);

  const jtdByProject = new Map(jtdRows.map((r) => [r.projectId, num(r.total)]));

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
    if (p.costCodeId == null) continue;
    const completedAmount = jtdByProject.get(p.id) ?? 0;
    const committedAmount = num(p.committedCost);
    const list = projectsByCode.get(p.costCodeId) ?? [];
    list.push({
      id: p.id,
      name: p.name,
      phase: p.phase,
      budget: num(p.budgetAmount),
      committed: committedAmount,
      completed: completedAmount,
    });
    projectsByCode.set(p.costCodeId, list);

    // Never hide real spend: a project can have posted GL before its contract
    // amount was ever recorded (or before it's formally marked complete), so
    // Planned/In Process show whichever is larger — the committed figure or
    // what's actually been spent so far.
    const bucket = bucketForPhase(p.phase);
    if (bucket === "planned") addToBucket(p.costCodeId, "planned", Math.max(committedAmount, completedAmount));
    else if (bucket === "in_process")
      addToBucket(p.costCodeId, "inProcess", Math.max(committedAmount, completedAmount));
    else addToBucket(p.costCodeId, "completed", completedAmount);
  }
  for (const r of unattributedGlRows) {
    if (r.costCodeId == null) continue;
    addToBucket(r.costCodeId, "completed", num(r.total));
  }

  const lineByCode = new Map(lines.map((l) => [l.costCodeId, l]));

  // Wave 2: queries that depend on Wave 1 results. The interior budget gets
  // pre-fetched cost codes and categories so it skips 2 internal DB queries.
  // avgTradeOut and tierLines depend on availableTiers from Wave 1.
  const [interior, avgTradeOutRows, tierLineRows] = await Promise.all([
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
    availableTiers.length
      ? db()
          .select({
            budgetGroupId: schema.budgetGroupLines.budgetGroupId,
            costCodeId: schema.budgetGroupLines.costCodeId,
            pricingMethod: schema.budgetGroupLines.pricingMethod,
            unitPrice: schema.budgetGroupLines.unitPrice,
            description: schema.budgetGroupLines.description,
            sortOrder: schema.budgetGroupLines.sortOrder,
            code: schema.costCodes.code,
            codeName: schema.costCodes.name,
            categoryName: schema.costCategories.name,
          })
          .from(schema.budgetGroupLines)
          .innerJoin(schema.costCodes, eq(schema.costCodes.id, schema.budgetGroupLines.costCodeId))
          .innerJoin(
            schema.costCategories,
            eq(schema.costCategories.id, schema.costCodes.categoryId),
          )
          .where(
            inArray(
              schema.budgetGroupLines.budgetGroupId,
              availableTiers.map((t) => t.id),
            ),
          )
          .orderBy(asc(schema.costCategories.sortOrder), asc(schema.budgetGroupLines.sortOrder))
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

  const editorTiers = availableTiers.map((t) => ({
    id: t.id,
    name: t.name,
    lines: tierLineRows
      .filter((l) => l.budgetGroupId === t.id)
      .map((l) => ({
        costCodeId: l.costCodeId,
        code: l.code,
        // The line's own description wins: cost-code names are chart-global, so a
        // per-property pricing basis ("Quartz 2cm $35/sf") only lives here.
        label: l.description ?? l.codeName,
        categoryName: l.categoryName,
        pricingMethod: l.pricingMethod,
        unitPrice: num(l.unitPrice),
      })),
  }));

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

  // Exterior view = everything that isn't unit interiors. Their exterior workbook
  // includes clubhouse, pool, amenities, soft costs and contingency, so this is
  // the whole non-interior budget, not just division 'exterior'.
  const visibleDivisions =
    view === "exterior" ? budgetDivisions.filter((d) => d.key !== "interiors") : budgetDivisions;

  const interiorNote = derivedInteriors
    ? `Interiors are computed from the interior plan — ${interior.unitGroups.length} unit group${interior.unitGroups.length === 1 ? "" : "s"} × ${interior.tiers.length} tier${interior.tiers.length === 1 ? "" : "s"}, ${money(interior.total)}. Edit them in the Interior view.`
    : null;

  const interiorCodeChoices = codes
    .filter((c) => c.isInterior)
    .map((c) => ({ id: c.id, code: c.code, name: c.name }));

  const categoryOptions = categories.map((c) => ({ id: c.id, code: c.code, name: c.name }));
  const costCodeOptions = codes.map((c) => ({
    id: c.id,
    categoryId: c.categoryId,
    code: c.code,
    name: c.name,
    isInterior: c.isInterior,
  }));
  const budgetedCostCodeIds = lines.map((l) => l.costCodeId);

  return (
    <div className="space-y-6">
      <PropertyHeader property={property} />

      <PropertyNav slug={property.slug} />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <BudgetViewSwitch value={view} />
          {view === "interior" ? (
            <InteriorBudgetToolbar
              propertyId={property.id}
              floorplans={availableFloorplans}
              tiers={availableTiers}
              existingColumns={existingColumns}
              editorTiers={editorTiers}
              cmPct={interior.settings.cmPct}
              contingencyPct={interior.settings.contingencyPct}
              cmCostCodeId={interior.settings.cmCostCodeId}
              contingencyCostCodeId={interior.settings.contingencyCostCodeId}
              interiorCodes={interiorCodeChoices}
            />
          ) : (
            <AddBudgetLineDialog
              propertyId={property.id}
              categories={categoryOptions}
              costCodes={costCodeOptions}
              budgetedCostCodeIds={budgetedCostCodeIds}
            />
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {view === "interior" ? (
            <InteriorBudgetPivot
              propertyId={property.id}
              unitGroups={interior.unitGroups.map((g) => ({
                id: g.id,
                name: g.name,
                avgSqft: g.avgSqft,
                unitCount: g.unitCount,
                countOverridden: g.countOverridden,
                sqftOverridden: g.sqftOverridden,
              }))}
              tiers={interior.tiers.map((t) => {
                const at = availableTiers.find((a) => a.id === t.id);
                return { id: t.id, name: t.name, targetTradeOut: at?.targetTradeOut ? num(at.targetTradeOut) : null };
              })}
              availableTiers={availableTiers.map((t) => ({ id: t.id, name: t.name }))}
              avgTradeOutByTier={Object.fromEntries(avgTradeOutByTier)}
              rows={interior.rows.map((r) => ({
                costCodeId: r.costCodeId,
                code: r.code,
                label: r.label,
                categoryName: r.categoryName,
              }))}
              cells={interior.cells.map((c) => ({
                unitGroupId: c.unitGroupId,
                tierId: c.tierId,
                costCodeId: c.costCodeId,
                amount: c.amount,
                quantity: c.quantity,
                pricingMethod: c.pricingMethod,
                tierUnitPrice: c.tierUnitPrice,
                overridden: c.overridden,
                overrideNote: c.overrideNote,
                overridePricingMethod: c.overridePricingMethod,
                overrideUnitPrice: c.overrideUnitPrice,
                note: c.note,
              }))}
              columns={interior.columns.map((c) => ({
                unitGroupId: c.unitGroupId,
                tierId: c.tierId,
                scopeTotal: c.scopeTotal,
                cm: c.cm,
                contingency: c.contingency,
                perUnitTotal: c.perUnitTotal,
                plannedUnits: c.plannedUnits,
                totalCost: c.totalCost,
                actualUnits: c.actualUnits,
              }))}
              total={interior.total}
              cmPct={interior.settings.cmPct}
              contingencyPct={interior.settings.contingencyPct}
              unmappedFloorplans={interior.unmappedFloorplans}
              unattributedProjects={interior.unattributedProjects}
              propertySlug={property.slug}
              rentRoll={rentRoll}
              availableFloorplans={availableFloorplans}
            />
          ) : (
            <>
              {view === "consolidated" && interiorNote && (
                <p className="text-[11px] text-ink-500">{interiorNote}</p>
              )}
              <BudgetView
                propertyId={property.id}
                propertySlug={property.slug}
                divisions={visibleDivisions}
              />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

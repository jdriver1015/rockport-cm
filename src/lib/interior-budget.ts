/**
 * Interior budget computation — the two-dimensional renovation budget.
 *
 * The model, in one line:
 *
 *   interior budget = Σ over (unit group × upgrade tier) of
 *                     (per-unit grand total × units planned)
 *
 * where the per-unit grand total is that tier's lines priced against that unit
 * group's metadata, plus the property's CM/supervision and contingency rates.
 *
 * Two rules this module exists to enforce:
 *
 *  1. **All pricing goes through `resolveGroupPricing`.** There is exactly one
 *     implementation of the percent base, and it lives in `src/lib/pricing.ts`.
 *     Never recompute a base or a line total here.
 *  2. **Unit counts and average square footage are derived, never stored.** They
 *     come from the latest committed rent roll through each group's floorplan
 *     map, so they cannot go stale. The `*Override` columns are only for
 *     pre-acquisition underwriting where no rent roll exists yet.
 *
 * Loading is set-based (`propertyIds[]`) because the portfolio home renders every
 * property at once — a per-property helper would be an N+1.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { num } from "@/lib/format";
import { resolveGroupPricing, roundMoney, type PricingMethod, type UnitMeta } from "@/lib/pricing";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A pivot column group, with its rent-roll-derived metrics resolved. */
export type UnitGroupDerived = {
  id: number;
  name: string;
  bedrooms: number | null;
  baths: number | null;
  /** Count-weighted average, or the override when set. Null when unknowable. */
  avgSqft: number | null;
  unitCount: number;
  floorPlanCodes: string[];
  countOverridden: boolean;
  sqftOverridden: boolean;
  sortOrder: number;
};

/** An upgrade tier — a budget_groups row that has at least one plan row. */
export type InteriorTier = { id: number; name: string; sortOrder: number };

/** One row of the pivot: a cost code, with its label and category. */
export type PivotRow = {
  costCodeId: number;
  code: string;
  /** budget_group_lines.description when set, else the cost code's name. */
  label: string;
  categoryId: number;
  categoryName: string;
  categorySortOrder: number;
};

/** One cell: what a single cost code costs for one (unit group × tier). */
export type PivotCell = {
  unitGroupId: number;
  tierId: number;
  costCodeId: number;
  amount: number;
  quantity: number;
  pricingMethod: PricingMethod;
  /**
   * The tier's stored price for this cost code, before derivation or pinning —
   * what the pivot's cell editor pre-fills when changing the tier price.
   */
  tierUnitPrice: number;
  pinned: boolean;
  pinNote: string | null;
  /** Engine warning, e.g. "Unit has no square footage on file". */
  note?: string;
};

/** One column's footer arithmetic, mirroring the underwriting tab's rows. */
export type PivotColumn = {
  unitGroupId: number;
  tierId: number;
  /** Σ non-percent lines. */
  subtotal: number;
  /** Σ percent lines. */
  softCosts: number;
  /** subtotal + softCosts — the underwriting tab's TOTAL row. */
  scopeTotal: number;
  cm: number;
  contingency: number;
  /** GRAND TOTAL per unit. */
  perUnitTotal: number;
  /** Fractional on purpose (e.g. 205.1). */
  plannedUnits: number;
  /** perUnitTotal × plannedUnits. */
  totalCost: number;
  /** Distinct units with a real project on this (group, tier). */
  actualUnits: number;
};

export type InteriorBudgetSettings = {
  cmPct: number;
  contingencyPct: number;
  cmCostCodeId: number | null;
  contingencyCostCodeId: number | null;
  groupingMode: "beds" | "floorplan" | "sqft";
  sqftBreakpoints: number[] | null;
};

export type InteriorBudget = {
  propertyId: number;
  /** False when no plan rows exist — callers fall back to hand-entered budget_lines. */
  hasPlan: boolean;
  unitGroups: UnitGroupDerived[];
  tiers: InteriorTier[];
  rows: PivotRow[];
  cells: PivotCell[];
  columns: PivotColumn[];
  /** Derived UW amount per interior cost code. Σ of these === `total`. */
  byCostCode: Map<number, number>;
  total: number;
  /** Rent-roll floorplans in no group — their units are silently excluded. */
  unmappedFloorplans: { floorPlanCode: string; unitCount: number }[];
  /** Unit projects whose floorplan matched no group. */
  unattributedProjects: number;
  settings: InteriorBudgetSettings;
};

const numOrNull = (v: string | number | null | undefined): number | null =>
  v == null ? null : num(v);

// ---------------------------------------------------------------------------
// Derivation of unit-group metrics
// ---------------------------------------------------------------------------

export type FloorplanStats = { count: number; sqftTotal: number; sqftCount: number };

/**
 * Resolve a group's unit count and average square footage from its mapped
 * floorplans.
 *
 * The average divides known square footage by the number of units that HAVE a
 * square footage — not by the total unit count — so a handful of units missing
 * the field doesn't drag the per-unit figure down. The count, by contrast, is
 * every unit in the group, because that's what the budget multiplies by.
 */
export function deriveUnitGroupMetrics(
  floorPlanCodes: readonly string[],
  stats: ReadonlyMap<string, FloorplanStats>,
  overrides: { unitCount: number | null; avgSqft: number | null },
): { unitCount: number; avgSqft: number | null; countOverridden: boolean; sqftOverridden: boolean } {
  let count = 0;
  let sqftTotal = 0;
  let sqftCount = 0;
  for (const code of floorPlanCodes) {
    const s = stats.get(code);
    if (!s) continue;
    count += s.count;
    sqftTotal += s.sqftTotal;
    sqftCount += s.sqftCount;
  }
  const derivedSqft = sqftCount > 0 ? roundMoney(sqftTotal / sqftCount) : null;
  return {
    unitCount: overrides.unitCount ?? count,
    avgSqft: overrides.avgSqft ?? derivedSqft,
    countOverridden: overrides.unitCount != null,
    sqftOverridden: overrides.avgSqft != null,
  };
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/** Raw rows `computeInteriorBudget` consumes. Exported so tests can synthesize them. */
export type InteriorBudgetInputs = Awaited<ReturnType<typeof loadInteriorInputs>>;
type Inputs = InteriorBudgetInputs;

/**
 * Fetch everything needed to compute interior budgets for a set of properties.
 * Fixed number of queries regardless of how many properties are asked for.
 */
export async function loadInteriorInputs(propertyIds: number[]) {
  if (propertyIds.length === 0) {
    return {
      groups: [], floorplans: [], plan: [], tiers: [], tierLines: [], pins: [],
      settings: [], rentRollUnits: [], costCodes: [], categories: [], unitProjects: [],
    };
  }

  const d = db();

  // Latest committed, non-archived rent roll per property. Fetched as a list and
  // reduced in JS rather than a correlated subquery per property.
  const batches = await d
    .select({
      id: schema.rentRollBatches.id,
      propertyId: schema.rentRollBatches.propertyId,
      asOfDate: schema.rentRollBatches.asOfDate,
      createdAt: schema.rentRollBatches.createdAt,
    })
    .from(schema.rentRollBatches)
    .where(
      and(
        inArray(schema.rentRollBatches.propertyId, propertyIds),
        eq(schema.rentRollBatches.status, "committed"),
        isNull(schema.rentRollBatches.archivedAt),
      ),
    );

  const latestBatchByProperty = new Map<number, number>();
  const rank = (b: (typeof batches)[number]) =>
    `${b.asOfDate ?? ""}|${new Date(b.createdAt).toISOString()}`;
  for (const b of [...batches].sort((x, y) => (rank(x) < rank(y) ? 1 : -1))) {
    if (!latestBatchByProperty.has(b.propertyId)) latestBatchByProperty.set(b.propertyId, b.id);
  }
  const batchIds = [...latestBatchByProperty.values()];

  const [groups, floorplans, plan, pins, settings, rentRollUnits, unitProjects] = await Promise.all([
    d.select().from(schema.interiorUnitGroups).where(inArray(schema.interiorUnitGroups.propertyId, propertyIds)),
    d
      .select()
      .from(schema.interiorUnitGroupFloorplans)
      .where(inArray(schema.interiorUnitGroupFloorplans.propertyId, propertyIds)),
    d.select().from(schema.interiorBudgetPlan).where(inArray(schema.interiorBudgetPlan.propertyId, propertyIds)),
    d
      .select()
      .from(schema.interiorBudgetLineOverrides)
      .where(inArray(schema.interiorBudgetLineOverrides.propertyId, propertyIds)),
    d
      .select()
      .from(schema.interiorBudgetSettings)
      .where(inArray(schema.interiorBudgetSettings.propertyId, propertyIds)),
    batchIds.length
      ? d
          .select({
            propertyId: schema.rentRollUnits.propertyId,
            floorPlanCode: schema.rentRollUnits.floorPlanCode,
            squareFeet: schema.rentRollUnits.squareFeet,
            beds: schema.rentRollUnits.beds,
            baths: schema.rentRollUnits.baths,
          })
          .from(schema.rentRollUnits)
          .where(inArray(schema.rentRollUnits.batchId, batchIds))
      : Promise.resolve([]),
    // Distinct-unit actuals per (property, floorplan, tier). Archived projects
    // excluded; a re-renovated unit must not count twice, so the caller dedupes
    // on unitId.
    d
      .select({
        propertyId: schema.projects.propertyId,
        unitId: schema.projects.unitId,
        budgetGroupId: schema.projects.budgetGroupId,
        floorplan: schema.units.floorplan,
        bedrooms: schema.units.bedrooms,
      })
      .from(schema.projects)
      .leftJoin(schema.units, eq(schema.projects.unitId, schema.units.id))
      .where(
        and(
          inArray(schema.projects.propertyId, propertyIds),
          eq(schema.projects.kind, "unit"),
          isNull(schema.projects.archivedAt),
        ),
      ),
  ]);

  // Tiers are budget groups referenced by a plan row (order rides sortOrder).
  const tierIds = [...new Set(plan.map((p) => p.budgetGroupId))];
  const [tiers, tierLines] = await Promise.all([
    tierIds.length
      ? d.select().from(schema.budgetGroups).where(inArray(schema.budgetGroups.id, tierIds))
      : Promise.resolve([]),
    tierIds.length
      ? d.select().from(schema.budgetGroupLines).where(inArray(schema.budgetGroupLines.budgetGroupId, tierIds))
      : Promise.resolve([]),
  ]);

  const codeIds = [...new Set(tierLines.map((l) => l.costCodeId))];
  const costCodes = codeIds.length
    ? await d.select().from(schema.costCodes).where(inArray(schema.costCodes.id, codeIds))
    : [];
  const categoryIds = [...new Set(costCodes.map((c) => c.categoryId))];
  const categories = categoryIds.length
    ? await d.select().from(schema.costCategories).where(inArray(schema.costCategories.id, categoryIds))
    : [];

  return { groups, floorplans, plan, tiers, tierLines, pins, settings, rentRollUnits, costCodes, categories, unitProjects };
}

// ---------------------------------------------------------------------------
// Computation (pure)
// ---------------------------------------------------------------------------

const DEFAULT_SETTINGS: InteriorBudgetSettings = {
  cmPct: 0,
  contingencyPct: 0,
  cmCostCodeId: null,
  contingencyCostCodeId: null,
  groupingMode: "beds",
  sqftBreakpoints: null,
};

/** Compute one property's interior budget from already-loaded rows. Pure. */
export function computeInteriorBudget(inputs: Inputs, propertyId: number): InteriorBudget {
  const planRows = inputs.plan.filter((p) => p.propertyId === propertyId);
  const settingsRow = inputs.settings.find((s) => s.propertyId === propertyId);
  const settings: InteriorBudgetSettings = settingsRow
    ? {
        cmPct: num(settingsRow.cmSupervisionPct),
        contingencyPct: num(settingsRow.contingencyPct),
        cmCostCodeId: settingsRow.cmCostCodeId,
        contingencyCostCodeId: settingsRow.contingencyCostCodeId,
        groupingMode: settingsRow.groupingMode,
        sqftBreakpoints: (settingsRow.sqftBreakpoints as number[] | null) ?? null,
      }
    : DEFAULT_SETTINGS;

  // --- rent roll stats by floorplan code -----------------------------------
  const stats = new Map<string, FloorplanStats>();
  const unmappedCounts = new Map<string, number>();
  for (const u of inputs.rentRollUnits) {
    if (u.propertyId !== propertyId) continue;
    const code = u.floorPlanCode ?? "";
    const s = stats.get(code) ?? { count: 0, sqftTotal: 0, sqftCount: 0 };
    s.count += 1;
    if (u.squareFeet != null) {
      s.sqftTotal += u.squareFeet;
      s.sqftCount += 1;
    }
    stats.set(code, s);
  }

  // --- unit groups ---------------------------------------------------------
  const codesByGroup = new Map<number, string[]>();
  for (const f of inputs.floorplans) {
    if (f.propertyId !== propertyId) continue;
    const list = codesByGroup.get(f.unitGroupId) ?? [];
    list.push(f.floorPlanCode);
    codesByGroup.set(f.unitGroupId, list);
  }

  const unitGroups: UnitGroupDerived[] = inputs.groups
    .filter((g) => g.propertyId === propertyId)
    .map((g) => {
      const floorPlanCodes = codesByGroup.get(g.id) ?? [];
      const m = deriveUnitGroupMetrics(floorPlanCodes, stats, {
        unitCount: g.unitCountOverride,
        avgSqft: numOrNull(g.avgSqftOverride),
      });
      return {
        id: g.id,
        name: g.name,
        bedrooms: g.bedrooms,
        baths: numOrNull(g.baths),
        avgSqft: m.avgSqft,
        unitCount: m.unitCount,
        floorPlanCodes,
        countOverridden: m.countOverridden,
        sqftOverridden: m.sqftOverridden,
        sortOrder: g.sortOrder,
      };
    })
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

  // Floorplans present in the rent roll but in no group — their units are
  // silently missing from the budget, so the UI must surface this.
  const mappedCodes = new Set(unitGroups.flatMap((g) => g.floorPlanCodes));
  for (const [code, s] of stats) {
    if (!mappedCodes.has(code)) unmappedCounts.set(code, s.count);
  }
  const unmappedFloorplans = [...unmappedCounts.entries()]
    .map(([floorPlanCode, unitCount]) => ({ floorPlanCode, unitCount }))
    .sort((a, b) => b.unitCount - a.unitCount);

  // --- tiers --------------------------------------------------------------
  const tierIds = new Set(planRows.map((p) => p.budgetGroupId));
  const tiers: InteriorTier[] = inputs.tiers
    .filter((t) => tierIds.has(t.id) && t.propertyId === propertyId)
    .map((t) => ({ id: t.id, name: t.name, sortOrder: t.sortOrder }))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

  const linesByTier = new Map<number, typeof inputs.tierLines>();
  for (const l of inputs.tierLines) {
    const list = linesByTier.get(l.budgetGroupId) ?? [];
    list.push(l);
    linesByTier.set(l.budgetGroupId, list);
  }
  for (const list of linesByTier.values()) {
    list.sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  }

  // --- actual project counts per (unit group, tier) ------------------------
  const groupByFloorplan = new Map<string, number>();
  for (const g of unitGroups) for (const c of g.floorPlanCodes) groupByFloorplan.set(c, g.id);
  const groupByBeds = new Map<number, number>();
  for (const g of unitGroups) if (g.bedrooms != null && !groupByBeds.has(g.bedrooms)) groupByBeds.set(g.bedrooms, g.id);

  const actualUnitIds = new Map<string, Set<number>>();
  let unattributedProjects = 0;
  for (const p of inputs.unitProjects) {
    if (p.propertyId !== propertyId || p.budgetGroupId == null || p.unitId == null) continue;
    // floorplan → bedrooms → unattributable. The wizard writes whatever
    // floorplan string it was handed, so an exact map hit isn't guaranteed.
    const gid =
      (p.floorplan != null ? groupByFloorplan.get(p.floorplan) : undefined) ??
      (p.bedrooms != null ? groupByBeds.get(p.bedrooms) : undefined);
    if (gid == null) {
      unattributedProjects++;
      continue;
    }
    const key = `${gid}:${p.budgetGroupId}`;
    const set = actualUnitIds.get(key) ?? new Set<number>();
    set.add(p.unitId); // dedupe: a re-renovated unit must not count twice
    actualUnitIds.set(key, set);
  }

  // --- price every cell ---------------------------------------------------
  const plannedByCell = new Map<string, number>();
  for (const p of planRows) plannedByCell.set(`${p.unitGroupId}:${p.budgetGroupId}`, num(p.plannedUnits));

  const cells: PivotCell[] = [];
  const columns: PivotColumn[] = [];
  const byCostCode = new Map<number, number>();
  const addCode = (codeId: number | null, amount: number) => {
    if (codeId == null || amount === 0) return;
    byCostCode.set(codeId, roundMoney((byCostCode.get(codeId) ?? 0) + amount));
  };

  const pinsForProperty = inputs.pins.filter((p) => p.propertyId === propertyId);

  for (const g of unitGroups) {
    const unit: UnitMeta = { sqft: g.avgSqft, bedrooms: g.bedrooms, baths: g.baths };
    for (const t of tiers) {
      const key = `${g.id}:${t.id}`;
      if (!plannedByCell.has(key)) continue; // no plan row = tier not offered here

      const lines = linesByTier.get(t.id) ?? [];
      const pins = pinsForProperty
        .filter((p) => p.budgetGroupId === t.id && p.unitGroupId === g.id)
        .map((p) => ({ costCodeId: p.costCodeId, amount: num(p.amount) }));
      const pinNoteByCode = new Map(
        pinsForProperty
          .filter((p) => p.budgetGroupId === t.id && p.unitGroupId === g.id)
          .map((p) => [p.costCodeId, p.note] as const),
      );

      const priced = resolveGroupPricing({
        lines: lines.map((l) => ({
          costCodeId: l.costCodeId,
          pricingMethod: l.pricingMethod as PricingMethod,
          unitPrice: num(l.unitPrice),
          defaultQuantity: numOrNull(l.defaultQuantity),
        })),
        unit,
        pins,
      });

      const plannedUnits = plannedByCell.get(key) ?? 0;

      for (const r of priced.perLine) {
        cells.push({
          unitGroupId: g.id,
          tierId: t.id,
          costCodeId: r.line.costCodeId,
          amount: r.total,
          quantity: r.quantity,
          pricingMethod: r.line.pricingMethod,
          tierUnitPrice: r.line.unitPrice,
          pinned: r.pinned,
          pinNote: r.pinned ? pinNoteByCode.get(r.line.costCodeId) ?? null : null,
          note: r.note,
        });
        addCode(r.line.costCodeId, roundMoney(r.total * plannedUnits));
      }

      // Uplifts apply to the tier's full per-unit scope cost and are attributed
      // to their own cost codes so the pivot reconciles to the Interiors band.
      const cm = roundMoney((settings.cmPct / 100) * priced.grandTotal);
      const contingency = roundMoney((settings.contingencyPct / 100) * priced.grandTotal);
      const perUnitTotal = roundMoney(priced.grandTotal + cm + contingency);
      addCode(settings.cmCostCodeId, roundMoney(cm * plannedUnits));
      addCode(settings.contingencyCostCodeId, roundMoney(contingency * plannedUnits));

      columns.push({
        unitGroupId: g.id,
        tierId: t.id,
        subtotal: priced.subtotal,
        softCosts: priced.softCosts,
        scopeTotal: priced.grandTotal,
        cm,
        contingency,
        perUnitTotal,
        plannedUnits,
        totalCost: roundMoney(perUnitTotal * plannedUnits),
        actualUnits: actualUnitIds.get(key)?.size ?? 0,
      });
    }
  }

  // --- pivot rows (cost codes that appear in any priced tier) -------------
  const usedCodeIds = new Set(cells.map((c) => c.costCodeId));
  const categoryById = new Map(inputs.categories.map((c) => [c.id, c]));
  const labelByCode = new Map<number, string>();
  for (const l of inputs.tierLines) {
    if (l.description?.trim()) labelByCode.set(l.costCodeId, l.description.trim());
  }
  const rows: PivotRow[] = inputs.costCodes
    .filter((c) => usedCodeIds.has(c.id))
    .map((c) => {
      const cat = categoryById.get(c.categoryId);
      return {
        costCodeId: c.id,
        code: c.code,
        label: labelByCode.get(c.id) ?? c.name,
        categoryId: c.categoryId,
        categoryName: cat?.name ?? "Uncategorized",
        categorySortOrder: cat?.sortOrder ?? 99,
      };
    })
    .sort(
      (a, b) =>
        a.categorySortOrder - b.categorySortOrder ||
        a.categoryName.localeCompare(b.categoryName) ||
        a.code.localeCompare(b.code),
    );

  return {
    propertyId,
    hasPlan: planRows.length > 0,
    unitGroups,
    tiers,
    rows,
    cells,
    columns,
    byCostCode,
    total: roundMoney(columns.reduce((s, c) => s + c.totalCost, 0)),
    unmappedFloorplans,
    unattributedProjects,
    settings,
  };
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/**
 * Interior budgets for many properties in a fixed number of queries.
 *
 * This is the ONLY sanctioned way to read an interior budget. Any caller that
 * sums `budget_lines.uw_amount` must exclude interior cost codes for properties
 * where `hasPlan` is true, or the interior budget double-counts.
 */
export async function computeInteriorBudgets(
  propertyIds: number[],
): Promise<Map<number, InteriorBudget>> {
  const inputs = await loadInteriorInputs(propertyIds);
  return new Map(propertyIds.map((id) => [id, computeInteriorBudget(inputs, id)]));
}

/** Single-property convenience. Prefer the plural form in list views. */
export async function computeInteriorBudgetFor(propertyId: number): Promise<InteriorBudget> {
  const budgets = await computeInteriorBudgets([propertyId]);
  return budgets.get(propertyId)!;
}

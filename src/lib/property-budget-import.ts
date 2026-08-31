import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import type { BudgetImportRow } from "@/lib/budget-import";
import { computePropertyBudget } from "@/lib/property-budget";

// ---------------------------------------------------------------------------
// Reconciling an uploaded budget against what the property already has.
//
// Two modes, not one, because "upload a budget" means genuinely different
// things at the two points this is offered:
//
//   merge     — new-property setup. There is nothing to conflict with yet, so
//               every matched row is simply added.
//   overwrite — an existing property's Budget tab. A row here can already
//               carry committed contracts and posted GL, and a naive
//               replace-all-rows would either orphan that spend or silently
//               erase it. A line the new file no longer mentions is archived
//               ONLY if nothing real is riding on it; a line with committed or
//               actual dollars against it is always left alone and always
//               reported, never silently dropped. That is the one rule this
//               whole feature cannot violate.
//
// Matching prefers a Cost Code column when the file has one — this app's own
// export always does — and falls back to the item's name otherwise, which is
// what an underwriter's own workbook gives us. A name match requires an exact
// case/whitespace-insensitive hit; anything else is reported as unresolved
// for a person to look at rather than guessed.
// ---------------------------------------------------------------------------

export type MatchedLine = {
  costCodeId: number;
  code: string;
  name: string;
  categoryName: string | null;
  from: number | null;
  to: number;
};

export type UnresolvedRow = {
  item: string;
  amount: number;
  reason: string;
};

export type AtRiskLine = {
  costCodeId: number;
  code: string;
  name: string;
  committed: number;
  completed: number;
};

export type ArchiveLine = {
  costCodeId: number;
  code: string;
  name: string;
  uwAmount: number;
};

export type BudgetImportPreview = {
  matched: MatchedLine[];
  unchangedCount: number;
  unresolved: UnresolvedRow[];
  atRisk: AtRiskLine[];
  toArchive: ArchiveLine[];
  totals: { before: number; after: number };
};

type ChartCostCode = {
  id: number;
  code: string;
  name: string;
  isInterior: boolean;
};

/**
 * The matching and reconciliation core, over plain inputs rather than a
 * database — a probe or the new-property flow (no property row exists yet, so
 * nothing to query) can call this directly with an empty `existingLines`.
 */
export function reconcileBudgetImport(
  rows: BudgetImportRow[],
  costCodes: ChartCostCode[],
  existingLines: Map<number, number>,
  spendByCode: Map<number, { committed: number; completed: number }>,
  mode: "merge" | "overwrite",
): BudgetImportPreview {
  const byCode = new Map(costCodes.map((c) => [c.code.trim().toLowerCase(), c]));
  const byName = new Map<string, ChartCostCode[]>();
  for (const c of costCodes) {
    const key = c.name.trim().toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), c]);
  }

  // Interior codes are out of scope for the whole function, not just the
  // matching half of it. Filtered once here rather than checked at each site
  // that touches existingLines below: a file for the non-interior budget can
  // never mention an interior code to begin with, so anything downstream that
  // still sees one — the archive list, the at-risk list, the before/after
  // totals — has already gone wrong once, which is exactly what happened the
  // first time this ran against real data.
  const interiorIds = new Set(costCodes.filter((c) => c.isInterior).map((c) => c.id));
  const existing = new Map([...existingLines].filter(([id]) => !interiorIds.has(id)));

  const matched: MatchedLine[] = [];
  const unresolved: UnresolvedRow[] = [];
  const seen = new Set<number>();

  for (const row of rows) {
    let costCode: ChartCostCode | undefined;
    let reason = "";

    if (row.code) {
      costCode = byCode.get(row.code.trim().toLowerCase());
      if (!costCode) reason = `no cost code "${row.code}" in this chart`;
    } else {
      const candidates = byName.get(row.item.trim().toLowerCase()) ?? [];
      if (candidates.length === 1) costCode = candidates[0];
      else if (candidates.length > 1) reason = `"${row.item}" matches ${candidates.length} cost codes — rename one or add a Cost Code column`;
      else reason = `no cost code named "${row.item}" in this chart`;
    }

    if (!costCode) {
      unresolved.push({ item: row.item, amount: row.amount, reason });
      continue;
    }
    if (costCode.isInterior) {
      // Interior codes are budgeted per unit through the renovation-type
      // system, never through a flat property-wide line — see the common-area
      // wizard's category picker, which excludes them for the same reason.
      // Importing one here would be a second, contradicting source of truth
      // for a number the interior plan already owns.
      unresolved.push({
        item: row.item,
        amount: row.amount,
        reason: `"${costCode.name}" is an interior category — budgeted per unit under Unit Upgrades, not here`,
      });
      continue;
    }

    seen.add(costCode.id);
    const from = existing.get(costCode.id) ?? null;
    if (from !== null && Math.abs(from - row.amount) < 0.005) continue; // unchanged

    matched.push({
      costCodeId: costCode.id,
      code: costCode.code,
      name: costCode.name,
      categoryName: row.category,
      from,
      to: row.amount,
    });
  }

  const unchangedCount = rows.length - matched.length - unresolved.length;

  // Only in overwrite mode does an existing line's absence from the file mean
  // anything — a merge (new property) has nothing to compare against, and
  // every existingLines entry is by definition something THIS import already
  // added moments ago, never a prior state to reconcile.
  const atRisk: AtRiskLine[] = [];
  const toArchive: ArchiveLine[] = [];
  if (mode === "overwrite") {
    const codeById = new Map(costCodes.map((c) => [c.id, c]));
    for (const [costCodeId, uwAmount] of existing) {
      if (seen.has(costCodeId)) continue;
      const code = codeById.get(costCodeId);
      if (!code) continue;
      const spend = spendByCode.get(costCodeId) ?? { committed: 0, completed: 0 };
      if (spend.committed > 0.005 || spend.completed > 0.005) {
        atRisk.push({ costCodeId, code: code.code, name: code.name, ...spend });
      } else {
        toArchive.push({ costCodeId, code: code.code, name: code.name, uwAmount });
      }
    }
  }

  const before = [...existing.values()].reduce((s, v) => s + v, 0);
  const afterDelta = matched.reduce((s, m) => s + (m.to - (m.from ?? 0)), 0);
  const archivedDelta = toArchive.reduce((s, a) => s + a.uwAmount, 0);
  const after = before + afterDelta - archivedDelta;

  return { matched, unchangedCount, unresolved, atRisk, toArchive, totals: { before, after } };
}

/** DB-backed preview for an existing property — the overwrite entry point. */
export async function previewBudgetImportForProperty(
  propertyId: number,
  chartOfAccountsId: number,
  rows: BudgetImportRow[],
): Promise<BudgetImportPreview> {
  const [costCodes, existingRows, budget] = await Promise.all([
    db()
      .select({
        id: schema.costCodes.id,
        code: schema.costCodes.code,
        name: schema.costCodes.name,
        isInterior: schema.costCodes.isInterior,
      })
      .from(schema.costCodes)
      .where(and(eq(schema.costCodes.chartId, chartOfAccountsId), eq(schema.costCodes.active, true))),
    db()
      .select({ costCodeId: schema.budgetLines.costCodeId, uwAmount: schema.budgetLines.uwAmount })
      .from(schema.budgetLines)
      .where(and(eq(schema.budgetLines.propertyId, propertyId), isNull(schema.budgetLines.archivedAt))),
    // Reused rather than re-derived: computePropertyBudget already resolves
    // committed/actual per cost code through every fallback rule that took
    // this codebase several tries to get right (unpriced scope, awarded bids
    // over project totals, unattributed GL). Re-deriving any of it here would
    // risk a second, quietly different answer to "does this line have real
    // spend" — the exact question an at-risk check cannot get wrong.
    computePropertyBudget(propertyId, chartOfAccountsId),
  ]);

  const existingLines = new Map(existingRows.map((r) => [r.costCodeId, Number(r.uwAmount)]));
  const spendByCode = new Map<number, { committed: number; completed: number }>();
  for (const division of budget.budgetDivisions) {
    for (const category of division.categories) {
      for (const line of category.lines) {
        spendByCode.set(line.costCodeId, {
          committed: line.planned + line.inProcess,
          completed: line.completed,
        });
      }
    }
  }

  return reconcileBudgetImport(rows, costCodes, existingLines, spendByCode, "overwrite");
}

/** DB-backed preview for a chart with no property yet — new-property setup. */
export async function previewBudgetImportForChart(
  chartOfAccountsId: number,
  rows: BudgetImportRow[],
): Promise<BudgetImportPreview> {
  const costCodes = await db()
    .select({
      id: schema.costCodes.id,
      code: schema.costCodes.code,
      name: schema.costCodes.name,
      isInterior: schema.costCodes.isInterior,
    })
    .from(schema.costCodes)
    .where(and(eq(schema.costCodes.chartId, chartOfAccountsId), eq(schema.costCodes.active, true)));

  return reconcileBudgetImport(rows, costCodes, new Map(), new Map(), "merge");
}

/**
 * Writes the matched lines and archives whatever the caller has already
 * decided is safe to archive (empty on the new-property path, since nothing
 * exists yet to conflict with).
 *
 * Atomicity is the caller's call, not this function's: the existing-property
 * overwrite wraps this in a transaction, because replacing a live budget is
 * one action and should not half-apply. New-property creation passes the bare
 * db handle instead, matching createProperty's existing convention for
 * template seeding — each step reports its own failure as a non-fatal note
 * rather than rolling back a property that is otherwise real.
 */
export async function applyBudgetImport(
  tx: Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0] | ReturnType<typeof db>,
  propertyId: number,
  matched: MatchedLine[],
  toArchive: ArchiveLine[] = [],
): Promise<void> {
  for (const line of matched) {
    // Read-then-write rather than an upsert: budget_lines' unique index on
    // (propertyId, costCodeId) is partial (WHERE archived_at IS NULL), so a
    // previously archived line for this code has to be revived in place, not
    // inserted alongside — inserting fresh would leave an orphaned archived
    // duplicate rather than one continuous history for the code.
    const existing = await tx.query.budgetLines.findFirst({
      where: and(eq(schema.budgetLines.propertyId, propertyId), eq(schema.budgetLines.costCodeId, line.costCodeId)),
    });
    if (existing) {
      await tx
        .update(schema.budgetLines)
        .set({ uwAmount: line.to.toFixed(2), archivedAt: null })
        .where(eq(schema.budgetLines.id, existing.id));
    } else {
      await tx.insert(schema.budgetLines).values({
        propertyId,
        costCodeId: line.costCodeId,
        uwAmount: line.to.toFixed(2),
      });
    }
  }

  for (const line of toArchive) {
    await tx
      .update(schema.budgetLines)
      .set({ archivedAt: new Date() })
      .where(
        and(
          eq(schema.budgetLines.propertyId, propertyId),
          eq(schema.budgetLines.costCodeId, line.costCodeId),
          isNull(schema.budgetLines.archivedAt),
        ),
      );
  }
}

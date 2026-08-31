/**
 * End-to-end probe of budget import, against the real database.
 *
 * Building this found a real incident, not just a bug: an earlier version of
 * this exact probe called applyBudgetImport's archive list — computed from a
 * deliberately near-empty test file — directly against Aston Post Oak, the
 * one real property in this database. Overwrite mode did exactly what it is
 * designed to do (archive every unprotected line the file did not mention),
 * which is correct behaviour on a genuine replacement and a live-data
 * incident on a test fixture standing in for one. It surfaced a real gap
 * along the way: interior-coded legacy budget_lines rows were not excluded
 * from the archive/at-risk reconciliation at all, so a non-interior file —
 * which can never "mention" an interior code to keep it alive — swept every
 * interior-coded row into the archive list on every single overwrite. Fixed
 * in reconcileBudgetImport by filtering interior codes out of the reconciled
 * set once, at the top, rather than checking for them at each site that
 * touches it.
 *
 * The fix here is procedural as much as it is code: every destructive check
 * below runs against a property this probe creates and destroys itself,
 * never against Aston. Aston is used only for read-only preview checks,
 * which cannot mutate anything no matter what they return.
 *
 *   npx tsx scripts/probe-budget-import.ts
 *
 * Exits non-zero if any assertion fails.
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { and, eq } from "drizzle-orm";
import { db, schema } from "../src/db";
import { budgetRowsFromGrid, detectBudgetMapping, findBudgetHeaderRow, type BudgetImportRow } from "../src/lib/budget-import";
import {
  reconcileBudgetImport,
  previewBudgetImportForProperty,
  previewBudgetImportForChart,
  applyBudgetImport,
} from "../src/lib/property-budget-import";
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

function row(item: string, amount: number, code: string | null = null): BudgetImportRow {
  return { item, amount, code, category: null, notes: null };
}

async function main() {
  const fx = await loadFixtures();

  // ---- pure parser: the exact messy shape a real capex workbook has —
  // titles above the header, a "-" formatted zero, a subtotal row.
  const grid = [
    ["Aston Post Oak"],
    ["CAPITAL BUDGET - EXTERIOR"],
    ["Item", "Quantity", "Unit", "Unit Price", "Year 1", "Total", "Notes"],
    ["Foundation", "", "", "", "-", "-", ""],
    ["Roof", "", "", "", "886900", "886900", ""],
    ["Subtotal - Deferred Maintenance", "", "", "", "886900", "886900", ""],
  ];
  const headerRow = findBudgetHeaderRow(grid);
  check("finds the header row past two title rows", headerRow === 2, `row ${headerRow}`);
  const mapping = detectBudgetMapping(grid[headerRow]);
  const rows = budgetRowsFromGrid(grid.slice(headerRow + 1), mapping);
  check("a dash-formatted zero is a real row, not skipped", rows.some((r) => r.item === "Foundation" && r.amount === 0));
  check("a subtotal row is excluded", !rows.some((r) => r.item.startsWith("Subtotal")));
  check("a real amount parses correctly", rows.find((r) => r.item === "Roof")?.amount === 886900);

  // ---- reconciliation core, entirely synthetic — no DB, so free to construct
  // whatever shape a real database might not currently have, like an existing
  // interior-coded line sitting unmentioned.
  const codes = [
    { id: 1, code: "1000-0001", name: "Gutters", isInterior: false },
    { id: 2, code: "1000-0002", name: "Paint Cabinets", isInterior: true },
    { id: 3, code: "1000-0003", name: "Roof", isInterior: false },
  ];

  const addResult = reconcileBudgetImport(
    [row("Gutters", 30000), row("Not A Real Category", 5000)],
    codes,
    new Map(),
    new Map(),
    "merge",
  );
  check("merge mode: a matched row is added", addResult.matched.length === 1 && addResult.matched[0].to === 30000);
  check("merge mode: an unmatched name is unresolved, not guessed", addResult.unresolved.length === 1);
  check("merge mode: nothing is ever at-risk or archived", addResult.atRisk.length === 0 && addResult.toArchive.length === 0);

  const interiorResult = reconcileBudgetImport([row("Paint Cabinets", 500)], codes, new Map(), new Map(), "merge");
  check(
    "an interior-category name is excluded from matching, not imported as a flat line",
    interiorResult.unresolved.length === 1 && interiorResult.matched.length === 0,
    interiorResult.unresolved[0]?.reason,
  );

  const existing = new Map([[1, 30000], [2, 400000], [3, 800000]]);
  const noSpend = new Map<number, { committed: number; completed: number }>();
  const unchangedResult = reconcileBudgetImport([row("Gutters", 30000)], codes, existing, noSpend, "overwrite");
  check("overwrite mode: an identical amount is unchanged, not re-matched", unchangedResult.matched.length === 0);
  check(
    "overwrite mode: a non-interior line missing from the file with no spend is archived",
    unchangedResult.toArchive.length === 1 && unchangedResult.toArchive[0].code === "1000-0003",
    unchangedResult.toArchive.map((a) => a.code).join(", "),
  );
  // The incident this probe exists to prevent a repeat of: an existing
  // interior-coded line (id 2, "Paint Cabinets") sits in `existing` totally
  // unmentioned by the uploaded file, exactly like every interior code always
  // will be for this feature. It must appear in neither list.
  check(
    "an existing interior-coded line is untouched by overwrite reconciliation — not archived, not at-risk",
    !unchangedResult.toArchive.some((a) => a.costCodeId === 2) && !unchangedResult.atRisk.some((a) => a.costCodeId === 2),
    `archive: ${unchangedResult.toArchive.map((a) => a.code).join(",")}; atRisk: ${unchangedResult.atRisk.map((a) => a.code).join(",")}`,
  );
  check(
    "the interior line's amount is excluded from the before/after totals too",
    unchangedResult.totals.before === 30000 + 800000,
    `before=${unchangedResult.totals.before} (want 830000, excluding the 400000 interior line)`,
  );

  const withSpend = new Map([[3, { committed: 0, completed: 42000 }]]);
  const spendResult = reconcileBudgetImport([row("Gutters", 30000)], codes, existing, withSpend, "overwrite");
  check(
    "overwrite mode: a line missing from the file WITH real spend is at-risk, not archived",
    spendResult.atRisk.length === 1 && spendResult.toArchive.length === 0,
    `${spendResult.atRisk[0]?.name}: $${spendResult.atRisk[0]?.completed} completed`,
  );

  const changedResult = reconcileBudgetImport([row("Gutters", 35000)], codes, existing, noSpend, "overwrite");
  check(
    "overwrite mode: a changed amount reports its from and to",
    changedResult.matched.length === 1 && changedResult.matched[0].from === 30000 && changedResult.matched[0].to === 35000,
  );

  // ---- read-only against the real database: previewing never writes
  // anything, so this is safe to run against Aston directly. Proven, not
  // assumed — a second read of the same cost code afterward confirms nothing
  // moved.
  const property = await db().query.properties.findFirst({ where: eq(schema.properties.id, fx.propertyId) });
  if (!property) throw new Error("fixture property vanished");
  const guttersBefore = await db().query.costCodes.findFirst({
    where: and(eq(schema.costCodes.chartId, property.chartOfAccountsId), eq(schema.costCodes.name, "Gutters")),
  });
  const guttersLineBefore = guttersBefore
    ? await db().query.budgetLines.findFirst({
        where: and(eq(schema.budgetLines.propertyId, fx.propertyId), eq(schema.budgetLines.costCodeId, guttersBefore.id)),
      })
    : undefined;

  await previewBudgetImportForProperty(fx.propertyId, property.chartOfAccountsId, [
    row("A file that mentions almost nothing", 1),
  ]);

  const guttersLineAfter = guttersBefore
    ? await db().query.budgetLines.findFirst({
        where: and(eq(schema.budgetLines.propertyId, fx.propertyId), eq(schema.budgetLines.costCodeId, guttersBefore.id)),
      })
    : undefined;
  check(
    "previewing is read-only — a real property's real line is untouched by a preview call alone",
    guttersLineBefore?.archivedAt === guttersLineAfter?.archivedAt && guttersLineBefore?.uwAmount === guttersLineAfter?.uwAmount,
    `before archivedAt=${guttersLineBefore?.archivedAt} uwAmount=${guttersLineBefore?.uwAmount}; after archivedAt=${guttersLineAfter?.archivedAt} uwAmount=${guttersLineAfter?.uwAmount}`,
  );

  const chartPreview = await previewBudgetImportForChart(property.chartOfAccountsId, [row("Gutters", 30000)]);
  check(
    "the chart-only preview (no property) resolves by name with nothing at risk",
    chartPreview.matched.length === 1 && chartPreview.atRisk.length === 0,
  );

  // ---- the write path itself: create, update, and overwrite-archive,
  // entirely on a throwaway property this probe owns start to finish. Reuses
  // Aston's chart to get real non-interior cost codes to write against, but
  // budget_lines is scoped by (propertyId, costCodeId) — nothing inserted
  // here can collide with or touch a single row that belongs to Aston.
  let throwawayId = 0;
  let glId = 0;
  try {
    const [throwaway] = await db()
      .insert(schema.properties)
      .values({
        name: "ZZ probe — budget import",
        slug: `zz-probe-budget-import-${Date.now()}`,
        chartOfAccountsId: property.chartOfAccountsId,
      })
      .returning({ id: schema.properties.id });
    throwawayId = throwaway.id;

    const nonInterior = await db()
      .select({ id: schema.costCodes.id, code: schema.costCodes.code, name: schema.costCodes.name })
      .from(schema.costCodes)
      .where(and(eq(schema.costCodes.chartId, property.chartOfAccountsId), eq(schema.costCodes.isInterior, false)))
      .limit(3);
    if (nonInterior.length < 3) throw new Error("need at least 3 non-interior cost codes on this chart to probe with");
    const [codeA, codeB, codeC] = nonInterior;

    // Seed the throwaway property with two lines directly (not through the
    // function under test), so this is a genuine reconciliation against prior
    // state rather than a comparison against nothing.
    await db().insert(schema.budgetLines).values([
      { propertyId: throwawayId, costCodeId: codeA.id, uwAmount: "10000.00" },
      { propertyId: throwawayId, costCodeId: codeB.id, uwAmount: "20000.00" },
    ]);

    const [gl] = await db()
      .insert(schema.glTransactions)
      .values({
        propertyId: throwawayId,
        costCodeId: codeB.id,
        amount: "5000.00",
        status: "posted",
        description: "ZZ probe — fabricated spend",
      })
      .returning({ id: schema.glTransactions.id });
    glId = gl.id;

    // A file that changes A, says nothing about B (which now carries real
    // spend), and adds C fresh.
    const preview = await previewBudgetImportForProperty(throwawayId, property.chartOfAccountsId, [
      row(codeA.name, 15000),
      row(codeC.name, 999),
    ]);
    check(
      "throwaway: the changed line is matched with its real from/to",
      preview.matched.some((m) => m.costCodeId === codeA.id && m.from === 10000 && m.to === 15000),
    );
    check(
      "throwaway: the new line is matched as added, from null",
      preview.matched.some((m) => m.costCodeId === codeC.id && m.from === null && m.to === 999),
    );
    check(
      "throwaway: the spend-bearing omitted line is at-risk, not archived",
      preview.atRisk.some((a) => a.costCodeId === codeB.id) && !preview.toArchive.some((a) => a.costCodeId === codeB.id),
    );

    await db().transaction((tx) => applyBudgetImport(tx, throwawayId, preview.matched, preview.toArchive));

    const linesAfter = await db()
      .select({ costCodeId: schema.budgetLines.costCodeId, uwAmount: schema.budgetLines.uwAmount, archivedAt: schema.budgetLines.archivedAt })
      .from(schema.budgetLines)
      .where(eq(schema.budgetLines.propertyId, throwawayId));
    const a = linesAfter.find((l) => l.costCodeId === codeA.id);
    const b = linesAfter.find((l) => l.costCodeId === codeB.id);
    const c = linesAfter.find((l) => l.costCodeId === codeC.id);
    check("throwaway: A updated to the new amount", Number(a?.uwAmount) === 15000 && !a?.archivedAt);
    check("throwaway: B — carrying real spend — is untouched, still active at its old amount", Number(b?.uwAmount) === 20000 && !b?.archivedAt);
    check("throwaway: C created fresh", Number(c?.uwAmount) === 999 && !c?.archivedAt);

    // Re-applying the identical file a second time should be a no-op — an
    // upsert-by-natural-key, not a growing history of duplicate rows.
    const secondPass = await previewBudgetImportForProperty(throwawayId, property.chartOfAccountsId, [
      row(codeA.name, 15000),
      row(codeC.name, 999),
    ]);
    check("throwaway: re-importing the same file finds nothing left to change", secondPass.matched.length === 0);
  } finally {
    if (glId) await db().delete(schema.glTransactions).where(eq(schema.glTransactions.id, glId));
    if (throwawayId) {
      await db().delete(schema.budgetLines).where(eq(schema.budgetLines.propertyId, throwawayId));
      await db().delete(schema.properties).where(eq(schema.properties.id, throwawayId));
    }
    console.log("  teardown: throwaway property and its rows removed; Aston was never written to");
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });

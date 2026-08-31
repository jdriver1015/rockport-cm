/**
 * Verifies the budget export workbook against the numbers the Budget page
 * itself renders, against the real database.
 *
 * This caught two real bugs on the first run that typecheck and lint could
 * not: the interior sheet's "Total per unit" row was wired to totalCost
 * (perUnitTotal × plannedUnits) instead of perUnitTotal, so an $11,157
 * renovation read as $278,936 — the aggregate for all 25 units at that tier,
 * not the cost of one. And the columns were in computation order rather than
 * the tier-major order the on-screen pivot uses, so a workbook opened next to
 * the page would not line up with it.
 *
 * Read-only. Builds a workbook in memory and asserts against it; writes
 * nothing to the database and no file to disk.
 *
 *   npx tsx scripts/probe-budget-export.ts
 *
 * Exits non-zero if any assertion fails.
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import ExcelJS from "exceljs";
import { db } from "../src/db";
import { computePropertyBudget } from "../src/lib/property-budget";
import { buildBudgetWorkbook } from "../src/lib/budget-export";

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

function rowsOf(ws: ExcelJS.Worksheet): unknown[][] {
  const out: unknown[][] = [];
  ws.eachRow((row) => out.push(row.values as unknown[]));
  return out;
}

async function main() {
  const property = await db().query.properties.findFirst();
  if (!property) throw new Error("no property to probe against");

  const budget = await computePropertyBudget(property.id, property.chartOfAccountsId);
  const buffer = await buildBudgetWorkbook(budget);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);

  check("workbook has both sheets", wb.worksheets.length === 2, wb.worksheets.map((s) => s.name).join(", "));

  // ---- Capital Budget: division rows sum to the non-interior total, and that
  // total matches what computePropertyBudget itself says the property's
  // non-interior budget is — two independent reads of the same number.
  const cap = wb.getWorksheet("Capital Budget");
  if (!cap) throw new Error("Capital Budget sheet missing");
  const capRows = rowsOf(cap);

  const nonInterior = budget.budgetDivisions.filter((d) => d.key !== "interiors");
  const expectedTotal = nonInterior.reduce((s, d) => s + d.budget, 0);

  const divisionRows = capRows.filter(
    (r) => typeof r[1] === "string" && !r[2] && !r[3] && r[1] !== "Total",
  );
  check(
    "every non-interior division appears as its own row",
    divisionRows.length === nonInterior.length,
    `${divisionRows.length} rows for ${nonInterior.length} divisions`,
  );
  const summedDivisions = divisionRows.reduce((s, r) => s + (Number(r[5]) || 0), 0);
  check(
    "division rows sum to the non-interior total",
    Math.abs(summedDivisions - expectedTotal) < 0.5,
    `${summedDivisions} vs ${expectedTotal}`,
  );

  const totalRow = capRows.find((r) => r[2] === "Total");
  check(
    "the sheet's own Total row matches",
    !!totalRow && Math.abs(Number(totalRow[5]) - expectedTotal) < 0.5,
    `${totalRow?.[5]} vs ${expectedTotal}`,
  );

  check(
    "interiors do not appear on the Capital Budget sheet",
    !capRows.some((r) => r[1] === "Interiors" || r[1] === "INTERIORS"),
  );

  // ---- Interior Renovation Budget: per-unit total is perUnitTotal, not
  // totalCost, and columns are ordered the way the on-screen pivot orders them.
  const int = wb.getWorksheet("Interior Renovation Budget");
  if (budget.interior.columns.length === 0) {
    check("interior sheet omitted when there is no plan", !int);
  } else if (!int) {
    check("Interior Renovation Budget sheet exists", false);
  } else {
    const intRows = rowsOf(int);
    const header = intRows[0];
    const dataColCount = header.length - 3; // values[] is 1-indexed; cols 1,2 are Category/Item

    // The same tier-major traversal InteriorBudgetPivot uses, computed
    // independently here rather than trusted from the export's own ordering.
    const byKey = new Map(
      budget.interior.columns.map((c) => [`${c.unitGroupId}:${c.tierId}`, c]),
    );
    const groupById = new Map(budget.interior.unitGroups.map((g) => [g.id, g]));
    const expectedOrder = budget.interior.tiers.flatMap((t) =>
      budget.interior.unitGroups
        .map((g) => byKey.get(`${g.id}:${t.id}`))
        .filter((c): c is NonNullable<typeof c> => c !== undefined)
        .map((c) => ({ ...c, tierName: t.name })),
    );
    check(
      "every interior column is present",
      dataColCount === expectedOrder.length,
      `${dataColCount} columns vs ${expectedOrder.length} pivot columns`,
    );

    const expectedHeaders = expectedOrder.map(
      (c) => `${groupById.get(c.unitGroupId)?.name ?? "Unknown"} — ${c.tierName}`,
    );
    const actualHeaders = header.slice(3) as string[];
    check(
      "columns are ordered tier-major, matching the on-screen pivot",
      JSON.stringify(actualHeaders) === JSON.stringify(expectedHeaders),
      `${actualHeaders.join(" | ")}`,
    );

    const perUnitRow = intRows.find((r) => r[2] === "Total per unit");
    const aggregateRow = intRows.find((r) => r[2] === "Total cost (all budgeted units)");
    check("both a per-unit and an aggregate total row exist", !!perUnitRow && !!aggregateRow);

    if (perUnitRow && expectedOrder.length > 0) {
      const values = (perUnitRow.slice(3) as number[]).map((v) => Number(v));
      check(
        "the per-unit row is perUnitTotal, not totalCost",
        values.every((v, i) => Math.abs(v - expectedOrder[i].perUnitTotal) < 0.5),
        values.map((v) => v.toFixed(2)).join(", "),
      );
      // The bug this probe exists to catch: totalCost is plannedUnits times
      // larger whenever a column has more than one unit. If the two rows are
      // reading the same field, at least one column with plannedUnits > 1
      // proves it.
      const multiUnit = expectedOrder.find((c) => c.plannedUnits > 1);
      if (multiUnit && aggregateRow) {
        const idx = expectedOrder.indexOf(multiUnit);
        const perUnitVal = Number((perUnitRow.slice(3) as number[])[idx]);
        const aggVal = Number((aggregateRow.slice(3) as number[])[idx]);
        check(
          "per-unit and aggregate genuinely differ on a multi-unit column",
          Math.abs(aggVal - perUnitVal * multiUnit.plannedUnits) < 0.5 && aggVal !== perUnitVal,
          `${multiUnit.plannedUnits} units: per-unit ${perUnitVal}, aggregate ${aggVal}`,
        );
      }
    }
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });

import ExcelJS from "exceljs";
import type { PropertyBudget } from "@/lib/property-budget";
import { num } from "@/lib/format";

// ---------------------------------------------------------------------------
// The property's whole budget, as a workbook.
//
// Two sheets, matching the two workbooks this replaces: "Capital Budget" is
// the shape of a UW capex export — Division > Category > Item, one row per
// cost code — with the live Committed and Actual columns a static UW export
// never had, since this one is never stale. "Interior Renovation Budget" is
// the tier x cost-code pivot, CM% and Contingency% included.
//
// Built from computePropertyBudget's own return value rather than re-querying,
// so the numbers in the file are guaranteed to be the numbers the Budget tab
// showed when it was requested — one source, not a second computation that can
// drift from the first.
// ---------------------------------------------------------------------------

const MONEY_FMT = "#,##0.00;(#,##0.00)";
const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF16233A" }, // --navy
};
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: "FFFFFFFF" } };
const SUBTOTAL_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFE4E7EA" }, // --band
};

function styleHeaderRow(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
  });
}

function moneyCell(row: ExcelJS.Row, col: number) {
  const cell = row.getCell(col);
  cell.numFmt = MONEY_FMT;
  return cell;
}

function addCapitalBudgetSheet(wb: ExcelJS.Workbook, budget: PropertyBudget) {
  const ws = wb.addWorksheet("Capital Budget", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = [
    { header: "Division", key: "division", width: 20 },
    { header: "Category", key: "category", width: 30 },
    { header: "Item", key: "item", width: 40 },
    { header: "Cost Code", key: "code", width: 12 },
    { header: "Approved", key: "approved", width: 16 },
    { header: "Committed", key: "committed", width: 16 },
    { header: "Actual", key: "actual", width: 16 },
    { header: "Variance", key: "variance", width: 16 },
    { header: "Notes", key: "notes", width: 30 },
  ];
  styleHeaderRow(ws.getRow(1));

  for (const division of budget.budgetDivisions) {
    // Interiors are a separate sheet — this one is the non-interior UW capex
    // budget, matching what the exterior workbook this replaces covered.
    if (division.key === "interiors") continue;

    const divRow = ws.addRow({ division: division.label, approved: division.budget });
    divRow.font = { bold: true };
    moneyCell(divRow, 5);
    for (const col of [6, 7, 8]) moneyCell(divRow, col);

    for (const category of division.categories) {
      const catRow = ws.addRow({ category: category.name, approved: category.budget });
      catRow.eachCell((cell) => (cell.fill = SUBTOTAL_FILL));
      moneyCell(catRow, 5);

      for (const line of category.lines) {
        const actual = line.completed;
        const variance = line.budget - actual;
        const row = ws.addRow({
          item: line.name,
          code: line.code,
          approved: line.budget,
          committed: line.inProcess + line.planned,
          actual,
          variance,
          notes: line.note ?? "",
        });
        moneyCell(row, 5);
        moneyCell(row, 6);
        moneyCell(row, 7);
        const varianceCell = moneyCell(row, 8);
        // Red text for a line running over, same rule the on-screen variance
        // column uses — a negative variance is money spent beyond what was
        // approved, and the workbook should read that at a glance too.
        if (variance < 0) varianceCell.font = { color: { argb: "FFB23B3B" } };
      }
    }
  }

  const total = budget.budgetDivisions
    .filter((d) => d.key !== "interiors")
    .reduce((s, d) => s + d.budget, 0);
  const totalRow = ws.addRow({ category: "Total", approved: total });
  totalRow.font = { bold: true };
  totalRow.eachCell((cell) => (cell.fill = SUBTOTAL_FILL));
  moneyCell(totalRow, 5);
}

function addInteriorSheet(wb: ExcelJS.Workbook, budget: PropertyBudget) {
  const { interior } = budget;
  if (interior.columns.length === 0) return;

  const ws = wb.addWorksheet("Interior Renovation Budget", {
    views: [{ state: "frozen", xSplit: 2, ySplit: 1 }],
  });

  const colKey = (unitGroupId: number, tierId: number) => `${unitGroupId}:${tierId}`;
  const groupById = new Map(interior.unitGroups.map((g) => [g.id, g]));
  const byKey = new Map(interior.columns.map((c) => [colKey(c.unitGroupId, c.tierId), c]));

  // Tier-major, unit-group-minor — the same traversal order
  // InteriorBudgetPivot builds its visibleColumns in, so a column's position
  // here matches its position on screen. Iterating interior.columns directly
  // used the order the computation happened to produce them in, which is not
  // that order.
  //
  // Every column, including a zero-planned one the on-screen pivot can hide:
  // a workbook meant to be edited and re-uploaded should show the whole
  // structure, not just whichever cells currently have units assigned.
  const orderedColumns = interior.tiers.flatMap((t) =>
    interior.unitGroups
      .map((g) => byKey.get(colKey(g.id, t.id)))
      .filter((c): c is NonNullable<typeof c> => c !== undefined)
      .map((c) => ({ ...c, tierName: t.name })),
  );

  const columns: Array<Partial<ExcelJS.Column>> = [
    { header: "Category", key: "category", width: 22 },
    { header: "Item", key: "item", width: 40 },
  ];
  for (const c of orderedColumns) {
    columns.push({
      key: colKey(c.unitGroupId, c.tierId),
      width: 16,
      header: `${groupById.get(c.unitGroupId)?.name ?? "Unknown"} — ${c.tierName}`,
    });
  }
  ws.columns = columns;
  styleHeaderRow(ws.getRow(1));

  const cellByRowCol = new Map<string, (typeof interior.cells)[number]>();
  for (const c of interior.cells) {
    cellByRowCol.set(`${c.costCodeId}:${colKey(c.unitGroupId, c.tierId)}`, c);
  }

  // Grouped by category, same order the on-screen pivot reads in, so a person
  // who has looked at the pivot recognises the workbook immediately.
  let currentCategory: string | null = null;
  for (const r of interior.rows) {
    if (r.categoryName !== currentCategory) {
      currentCategory = r.categoryName;
      const headRow = ws.addRow({ category: currentCategory });
      headRow.font = { bold: true };
      headRow.eachCell((cell) => (cell.fill = SUBTOTAL_FILL));
    }
    const values: Record<string, string | number> = { item: r.label };
    for (const c of orderedColumns) {
      const key = colKey(c.unitGroupId, c.tierId);
      const cell = cellByRowCol.get(`${r.costCodeId}:${key}`);
      if (cell) values[key] = num(cell.amount);
    }
    const row = ws.addRow(values);
    for (let i = 0; i < orderedColumns.length; i++) moneyCell(row, 3 + i);
  }

  // perUnitTotal, not totalCost — the GRAND TOTAL / UNIT figure the on-screen
  // pivot shows. totalCost is that times plannedUnits, the aggregate for the
  // whole column, which is a different and much larger number: a $11,157
  // per-unit renovation read as $278,936 the first time this ran, because the
  // two fields differ only by a multiplication nothing here signals.
  const totalRow = ws.addRow({ item: "Total per unit" });
  totalRow.font = { bold: true };
  for (let i = 0; i < orderedColumns.length; i++) {
    moneyCell(totalRow, 3 + i).value = orderedColumns[i].perUnitTotal;
  }
  totalRow.eachCell((cell) => (cell.fill = SUBTOTAL_FILL));

  const plannedRow = ws.addRow({ item: "Units budgeted" });
  for (let i = 0; i < orderedColumns.length; i++) {
    plannedRow.getCell(3 + i).value = orderedColumns[i].plannedUnits;
  }

  // The aggregate, clearly labelled and separate from the per-unit row above —
  // real spend across every unit at this tier, which a proforma needs and the
  // on-screen pivot does not show as its own line.
  const aggregateRow = ws.addRow({ item: "Total cost (all budgeted units)" });
  for (let i = 0; i < orderedColumns.length; i++) {
    moneyCell(aggregateRow, 3 + i).value = orderedColumns[i].totalCost;
  }
}

/** The whole property budget as an .xlsx buffer. */
export async function buildBudgetWorkbook(budget: PropertyBudget): Promise<ExcelJS.Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Rockport Construction Manager";
  wb.created = new Date();

  addCapitalBudgetSheet(wb, budget);
  addInteriorSheet(wb, budget);

  return wb.xlsx.writeBuffer();
}

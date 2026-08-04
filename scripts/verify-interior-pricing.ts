/**
 * Acceptance harness for the interior budget model.
 *
 * Codifies two things that must never drift:
 *
 * 1. **Group-pricing invariants** — the `percent` base is Σ non-percent lines,
 *    percent lines never compound and are order-independent, and a pin is a
 *    dollar amount at quantity 1 (never multiplied by square footage).
 * 2. **Rockport's published numbers** for Aston Post Oak, from
 *    `Aston Post Oak - Unit Renovation Summary - Final UW.xlsx`. If the pivot or
 *    the rollup ever stops reproducing these, the model has broken.
 *
 * Run: npx tsx scripts/verify-interior-pricing.ts
 */
import { roundMoney, resolveGroupPricing, type PricingMethod, type UnitMeta } from "../src/lib/pricing";
import { computeInteriorBudget, type InteriorBudgetInputs } from "../src/lib/interior-budget";
import { proposeUnitGroups, reconcileUnitGroups } from "../src/lib/interior-unit-grouping";

type Line = {
  costCodeId: number;
  pricingMethod: PricingMethod;
  unitPrice: number;
  defaultQuantity?: number | null;
  quantityFormula?: string | null;
};

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}\n       expected ${e}\n       actual   ${a}`);
  }
}

// ---------------------------------------------------------------------------
console.log("\n[1] Group-pricing invariants");

{
  const unit: UnitMeta = { sqft: 1000, bedrooms: 2, baths: 2 };
  const scope: Line[] = [{ costCodeId: 1, pricingMethod: "fixed", unitPrice: 1000 }];
  const cm: Line = { costCodeId: 90, pricingMethod: "percent", unitPrice: 5 };
  const cont: Line = { costCodeId: 91, pricingMethod: "percent", unitPrice: 7 };

  const a = resolveGroupPricing({ lines: [...scope, cm, cont], unit });
  const b = resolveGroupPricing({ lines: [cont, cm, ...scope], unit });
  check("percent base excludes percent lines", a.subtotal, 1000);
  check("percent lines do not compound", a.softCosts, 120);
  check("percent order-independent", b.grandTotal, a.grandTotal);
  check("grandTotal = subtotal + softCosts", a.grandTotal, 1120);
}

{
  const unit: UnitMeta = { sqft: 1000, bedrooms: 2, baths: 2 };
  const lines: Line[] = [
    { costCodeId: 1, pricingMethod: "sqft", unitPrice: 4 }, // would derive 4,000
    { costCodeId: 2, pricingMethod: "fixed", unitPrice: 200 },
    { costCodeId: 90, pricingMethod: "percent", unitPrice: 10 },
  ];
  const r = resolveGroupPricing({ lines, unit, pins: [{ costCodeId: 1, amount: 2500 }] });
  const pinned = r.perLine[0];
  check("pin is a dollar amount at qty 1, not a rate", [pinned.quantity, pinned.total], [1, 2500]);
  check("pin flagged for the UI", pinned.pinned, true);
  check("pin feeds the percent base", r.subtotal, 2700);
  check("percent applies to the pinned base", r.softCosts, 270);
  check("caller line order preserved", r.perLine.map((l) => l.line.costCodeId), [1, 2, 90]);
  check(
    "qty × unitPrice === total for every line",
    r.perLine.every((l) => roundMoney(l.quantity * l.unitPrice) === l.total),
    true,
  );
}

// ---------------------------------------------------------------------------
console.log("\n[2] Rockport per-unit grand totals (Interior Capital Budget tab)");

// Uplifts are plan-level rates applied on top of the tier's grand total — they
// are NOT scope lines, so they never reach a project's scope_items.
const CM_PCT = 5;
const CONTINGENCY_PCT = 7;

function withUplifts(grandTotal: number) {
  const cm = roundMoney((CM_PCT / 100) * grandTotal);
  const contingency = roundMoney((CONTINGENCY_PCT / 100) * grandTotal);
  return { cm, contingency, total: roundMoney(grandTotal + cm + contingency) };
}

// Their 1BR Enhanced (column D) and 2BR Enhanced (column H) allocations.
const COLUMNS = [
  { label: "1BR Enhanced", amounts: [338, 525, 1001, 950, 0, 1750, 200, 750], total: 5514, grand: 6175.68 },
  { label: "2BR Enhanced", amounts: [338, 797, 1500, 950, 0, 2000, 375, 500], total: 6460, grand: 7235.2 },
] as const;

for (const col of COLUMNS) {
  const lines: Line[] = col.amounts.map((a, i) => ({
    costCodeId: i + 1,
    pricingMethod: "fixed" as PricingMethod,
    unitPrice: a,
  }));
  const r = resolveGroupPricing({ lines, unit: {} });
  check(`${col.label} TOTAL`, r.grandTotal, col.total);
  check(`${col.label} GRAND TOTAL (+5% CM, +7% contingency)`, withUplifts(r.grandTotal).total, col.grand);
}

// ---------------------------------------------------------------------------
console.log("\n[3] Unit-group derivation and penetration counts (RR tab)");

// Avg SF uses each floorplan's TOTAL RSF, not count × the rounded NSF/unit —
// NSF/unit is itself an average, and multiplying it back out lands on 837.64.
// The implementation sums per-unit rent_roll_units.squareFeet, which is this.
const UNIT_GROUPS = [
  {
    label: "1BR",
    floorplans: [
      { count: 4, rsf: 2552 }, { count: 76, rsf: 51224 }, { count: 4, rsf: 3100 },
      { count: 44, rsf: 34148 }, { count: 38, rsf: 32832 }, { count: 8, rsf: 6952 },
      { count: 4, rsf: 3596 }, { count: 47, rsf: 42958 }, { count: 68, rsf: 68068 },
    ],
    expectedCount: 293,
    expectedRsf: 245430,
    expectedAvgSf: 837.65,
  },
] as const;

for (const g of UNIT_GROUPS) {
  const count = g.floorplans.reduce((s, f) => s + f.count, 0);
  const rsf = g.floorplans.reduce((s, f) => s + f.rsf, 0);
  check(`${g.label} unit count`, count, g.expectedCount);
  check(`${g.label} total RSF`, rsf, g.expectedRsf);
  check(`${g.label} count-weighted avg SF`, Math.round((rsf / count) * 100) / 100, g.expectedAvgSf);
}

// Penetration → count. Fractional on purpose: rounding 205.1 to 205 shifts the
// budget ~$9k and breaks the tie to the underwriting model.
check("1BR Enhanced count @ 70%", roundMoney(293 * 0.7), 205.1);
check("1BR Signature count @ 0%", roundMoney(293 * 0), 0);
check("1BR Designer count @ 30%", roundMoney(293 * 0.3), 87.9);
check("2BR Enhanced count @ 70%", roundMoney(99 * 0.7), 69.3);
check("2BR Designer count @ 30%", roundMoney(99 * 0.3), 29.7);

// The interior budget itself: Σ (grand total per unit × count).
//
// We keep full precision; their tab does not. Rockport rounds each column's
// Total Costs to the nearest $100 (D51 displays 1,266,700 for an actual
// 1,266,631.97), so their grand total reads ~$3,986,100 against our exact
// $3,985,917.60. Their J51 is looser still — 637,300 displayed against
// 21,454.72 × 29.7 = 637,205.18, which doesn't tie even allowing for the
// rounding. Do NOT "correct" our figure to match theirs.
{
  const columns = [
    { label: "1BR Enhanced", grand: 6175.68, count: 205.1 },
    { label: "1BR Designer", grand: 17982.72, count: 87.9 },
    { label: "2BR Enhanced", grand: 7235.2, count: 69.3 },
    { label: "2BR Designer", grand: 21454.72, count: 29.7 },
  ];
  const interiorBudget = roundMoney(columns.reduce((s, c) => s + c.grand * c.count, 0));
  check("interior budget Σ (exact, unrounded)", interiorBudget, 3985917.6);
  check("within $200 of their rounded $3,986,100", Math.abs(interiorBudget - 3986100) < 200, true);
}

// ---------------------------------------------------------------------------
console.log("\n[4] End-to-end: computeInteriorBudget reproduces Aston Post Oak");

// Drives the real compute layer with synthetic rows shaped exactly like the DB,
// so the whole pipeline is exercised: rent-roll → unit-group derivation →
// tier pricing → pins → uplifts → per-cost-code rollup.
{
  const PROP = 1;
  const TIER = 10; // "Enhanced"

  /** Split an integer total across n units so the per-unit values sum exactly. */
  function distribute(total: number, n: number): number[] {
    const base = Math.floor(total / n);
    const remainder = total - base * n;
    return Array.from({ length: n }, (_, i) => (i < remainder ? base + 1 : base));
  }

  const ONE_BR = [
    ["E1", 4, 2552], ["A1", 76, 51224], ["A3", 4, 3100], ["A2", 44, 34148],
    ["A4", 38, 32832], ["A5", 8, 6952], ["A6", 4, 3596], ["A7", 47, 42958],
    ["A8", 68, 68068],
  ] as const;
  const TWO_BR = [["B1", 99, 131738]] as const; // 99 units, avg 1330.69

  const rentRollUnits = [...ONE_BR, ...TWO_BR].flatMap(([code, count, rsf]) =>
    distribute(rsf, count).map((squareFeet) => ({
      propertyId: PROP,
      floorPlanCode: code,
      squareFeet,
      beds: code.startsWith("B") ? 2 : 1,
      baths: code.startsWith("B") ? "2.0" : "1.0",
    })),
  );

  // Enhanced tier priced at the 1BR column; the 2BR column differs on five
  // step-priced lines, expressed as pins.
  const LINES = [
    { costCodeId: 1, name: "Backsplash", price: 338, pin2br: null },
    { costCodeId: 2, name: "Paint Cabinets", price: 525, pin2br: 797 },
    { costCodeId: 3, name: "Hardware Package", price: 1001, pin2br: 1500 },
    { costCodeId: 4, name: "Plumbing fixtures", price: 950, pin2br: null },
    { costCodeId: 5, name: "Carpet", price: 0, pin2br: null },
    { costCodeId: 6, name: "Full paint & color change", price: 1750, pin2br: 2000 },
    { costCodeId: 7, name: "Cleaning", price: 200, pin2br: 375 },
    { costCodeId: 8, name: "In-house or third party labor", price: 750, pin2br: 500 },
  ];

  const inputs = {
    groups: [
      { id: 100, propertyId: PROP, name: "1BR", bedrooms: 1, baths: "1.0", unitCountOverride: null, avgSqftOverride: null, sourceBatchId: null, sortOrder: 0, createdAt: new Date() },
      { id: 200, propertyId: PROP, name: "2BR", bedrooms: 2, baths: "2.0", unitCountOverride: null, avgSqftOverride: null, sourceBatchId: null, sortOrder: 1, createdAt: new Date() },
    ],
    floorplans: [
      ...ONE_BR.map(([code], i) => ({ id: i + 1, propertyId: PROP, unitGroupId: 100, floorPlanCode: code })),
      ...TWO_BR.map(([code], i) => ({ id: 50 + i, propertyId: PROP, unitGroupId: 200, floorPlanCode: code })),
    ],
    plan: [
      { id: 1, propertyId: PROP, unitGroupId: 100, budgetGroupId: TIER, plannedUnits: "205.10", note: null },
      { id: 2, propertyId: PROP, unitGroupId: 200, budgetGroupId: TIER, plannedUnits: "69.30", note: null },
    ],
    tiers: [
      { id: TIER, propertyId: PROP, name: "Enhanced", description: null, sourceTemplateId: null, active: true, sortOrder: 0, createdAt: new Date(), archivedAt: null },
    ],
    tierLines: LINES.map((l, i) => ({
      id: i + 1, budgetGroupId: TIER, costCodeId: l.costCodeId,
      pricingMethod: "fixed" as const, unitPrice: l.price.toFixed(2),
      defaultQuantity: null, description: null, notes: null, sortOrder: i,
    })),
    pins: LINES.filter((l) => l.pin2br != null).map((l, i) => ({
      id: i + 1, propertyId: PROP, budgetGroupId: TIER, costCodeId: l.costCodeId,
      unitGroupId: 200, amount: l.pin2br!.toFixed(2), note: "GC quote", createdBy: null, createdAt: new Date(),
    })),
    settings: [
      { propertyId: PROP, cmSupervisionPct: "5.000", contingencyPct: "7.000", cmCostCodeId: 90, contingencyCostCodeId: 91, groupingMode: "beds" as const, sqftBreakpoints: null, updatedAt: new Date() },
    ],
    rentRollUnits,
    costCodes: [
      ...LINES.map((l) => ({ id: l.costCodeId, chartId: 1, categoryId: 1, code: `4000-000${l.costCodeId}`, name: l.name, isInterior: true, active: true })),
      { id: 90, chartId: 1, categoryId: 2, code: "4400-0001", name: "Interior CM / Supervision", isInterior: true, active: true },
      { id: 91, chartId: 1, categoryId: 2, code: "4400-0002", name: "Interior Contingency", isInterior: true, active: true },
    ],
    categories: [
      { id: 1, chartId: 1, code: "4000", name: "Kitchen & Bathroom", sortOrder: 0, division: "interiors" },
      { id: 2, chartId: 1, code: "4400", name: "Interior Soft Costs", sortOrder: 4, division: "interiors" },
    ],
    unitProjects: [],
  } as unknown as InteriorBudgetInputs;

  const b = computeInteriorBudget(inputs, PROP);

  const g1 = b.unitGroups.find((g) => g.name === "1BR")!;
  const g2 = b.unitGroups.find((g) => g.name === "2BR")!;
  check("1BR derived unit count", g1.unitCount, 293);
  check("1BR derived avg SF", g1.avgSqft, 837.65);
  check("2BR derived unit count", g2.unitCount, 99);
  check("2BR derived avg SF", g2.avgSqft, 1330.69);
  check("no unmapped floorplans", b.unmappedFloorplans, []);
  check("hasPlan", b.hasPlan, true);

  const col1 = b.columns.find((c) => c.unitGroupId === g1.id)!;
  const col2 = b.columns.find((c) => c.unitGroupId === g2.id)!;
  check("1BR Enhanced TOTAL", col1.scopeTotal, 5514);
  check("1BR Enhanced GRAND TOTAL per unit", col1.perUnitTotal, 6175.68);
  check("2BR Enhanced TOTAL (via pins)", col2.scopeTotal, 6460);
  check("2BR Enhanced GRAND TOTAL per unit", col2.perUnitTotal, 7235.2);
  check("1BR Enhanced total cost", col1.totalCost, 1266631.97);
  check("2BR Enhanced total cost", col2.totalCost, 501399.36);

  // The reconciliation that matters: per-cost-code rollup must equal the Σ of
  // column totals, or the Budget tab's Interiors band won't match the pivot.
  const codeSum = roundMoney([...b.byCostCode.values()].reduce((s, v) => s + v, 0));
  check("Σ byCostCode === Σ column totals", codeSum, b.total);
  check("interior total", b.total, roundMoney(1266631.97 + 501399.36));

  // Uplifts must be attributed to their own cost codes, not left floating.
  const cmDollars = roundMoney(col1.cm * col1.plannedUnits + col2.cm * col2.plannedUnits);
  check("CM attributed to its cost code", b.byCostCode.get(90), cmDollars);
  check("contingency attributed to its cost code", b.byCostCode.get(91), roundMoney(col1.contingency * col1.plannedUnits + col2.contingency * col2.plannedUnits));

  // Pins land only on the group they were written for.
  const cleaning1 = b.cells.find((c) => c.costCodeId === 7 && c.unitGroupId === g1.id)!;
  const cleaning2 = b.cells.find((c) => c.costCodeId === 7 && c.unitGroupId === g2.id)!;
  check("1BR cleaning derived", [cleaning1.amount, cleaning1.pinned], [200, false]);
  check("2BR cleaning pinned", [cleaning2.amount, cleaning2.pinned], [375, true]);

  check("pivot rows grouped by category order", b.rows.map((r) => r.categoryName)[0], "Kitchen & Bathroom");
}

// ---------------------------------------------------------------------------
console.log("\n[5] Unit-group seeding and reconciliation");

{
  const facts = [
    { floorPlanCode: "E1", count: 4, avgSqft: 638, bedrooms: 0, baths: 1 },
    { floorPlanCode: "A1", count: 76, avgSqft: 674, bedrooms: 1, baths: 1 },
    { floorPlanCode: "A8", count: 68, avgSqft: 1001, bedrooms: 1, baths: 1.5 },
    { floorPlanCode: "B1", count: 99, avgSqft: 1330, bedrooms: 2, baths: 2 },
  ];

  const beds = proposeUnitGroups(facts, "beds");
  check("beds mode names", beds.map((g) => g.name), ["Studio", "1BR", "2BR"]);
  check(
    "beds mode ignores baths (1BR/1BA + 1BR/1.5BA stay together)",
    beds.find((g) => g.name === "1BR")!.floorPlanCodes,
    ["A1", "A8"],
  );
  check(
    "beds mode takes count-weighted modal baths",
    beds.find((g) => g.name === "1BR")!.baths,
    1, // A1's 76 units at 1 bath outweigh A8's 68 at 1.5
  );

  const fp = proposeUnitGroups(facts, "floorplan");
  check("floorplan mode is one group per code", fp.map((g) => g.name), ["A1", "A8", "B1", "E1"]);

  const sqft = proposeUnitGroups(facts, "sqft", [700, 1100]);
  check("sqft mode band names", sqft.map((g) => g.name), ["Up to 699 SF", "700–1,099 SF", "1,100+ SF"]);
  check("sqft mode band membership", sqft[0].floorPlanCodes, ["A1", "E1"]);

  // Reconcile must key on the floorplan SET, not the name — otherwise a group the
  // user renamed gets dropped and rebuilt, taking its pins with it.
  const existing = [
    { id: 1, name: "Renamed by hand", floorPlanCodes: ["A8", "A1"] }, // same set, different order
    { id: 2, name: "2BR", floorPlanCodes: ["B1"] },
    { id: 3, name: "Stale group", floorPlanCodes: ["ZZ"] },
  ];
  const r = reconcileUnitGroups(existing, beds);
  check("renamed group with unchanged floorplans is kept", r.keep.map((k) => k.id).sort(), [1, 2]);
  check("kept entry carries its proposal by reference", r.keep.every((k) => beds.includes(k.proposed)), true);
  check("genuinely new group is created", r.create.map((c) => c.name), ["Studio"]);
  check("group whose floorplans vanished is flagged for removal", r.remove.map((g) => g.id), [3]);
}

console.log(failures === 0 ? "\n✓ All checks passed.\n" : `\n✗ ${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);

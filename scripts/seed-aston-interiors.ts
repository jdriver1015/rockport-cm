/**
 * One-time seed: extends the "Rockport" chart of accounts with the interior
 * (unit-turn) side and loads Aston Post Oak's interior renovation budget.
 *
 * Adds a full Interiors division — Kitchen & Bathroom, Flooring, Paint, Other,
 * and Interior Soft Costs — with a cost code per workbook line item (including
 * the options that are $0 at this property, so the chart is a complete reusable
 * turn catalog). Budget lines are created only for the lines that carry a
 * blended cost here, using the existing interior per-unit model
 * (perUnitAmount x plannedUnits).
 *
 * The interior workbook prices each line across a tier x unit-type grid
 * (1BR/2BR x Enhanced/Signature/Designer). Per Jimmy, the budget is a single
 * portfolio-blended per-unit average — blended $/unit = Σ(cell $ × cell count)
 * ÷ 392 units — with tier-specific detail living in the scope groups. Totals
 * reconcile to the workbook's $3,986,100 within rounding (~$182; the workbook
 * rounds each tier's grand total before multiplying).
 *
 * Source: Aston Post Oak - Unit Renovation Summary - Final UW.xlsx
 * Run: npx tsx scripts/seed-aston-interiors.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq } from "drizzle-orm";
import postgres from "postgres";
import {
  budgetLines,
  chartsOfAccounts,
  costCategories,
  costCodes,
  properties,
} from "../src/db/schema";

const UNIT_COUNT = 392;

/** perUnit is the portfolio-blended average; null = no budget line at this property. */
type Item = { name: string; perUnit: number | null };
type Category = { code: string; name: string; items: Item[] };

const CATEGORIES: Category[] = [
  {
    code: "4000",
    name: "Kitchen & Bathroom",
    items: [
      { name: "Designer SS Appliances", perUnit: 1050.0 },
      { name: "Basic SS Appliances", perUnit: null },
      { name: "Designer Flair Item", perUnit: null },
      { name: "Backsplash", perUnit: 338.0 },
      { name: "Under cabinet lighting", perUnit: null },
      { name: "Kitchen quartz countertops 2cm $35/sf", perUnit: 660.31 },
      { name: "Optional double waterfall edge", perUnit: null },
      { name: "Paint Cabinets", perUnit: 415.59 },
      { name: "Replace cabinet fronts (laminate peeling fronts/damaged)", perUnit: 671.52 },
      { name: "Add upper boxes in kitchen and new full height doors", perUnit: null },
      { name: "Quartz vanities", perUnit: null },
      { name: "LED Mirror", perUnit: 180.31 },
      { name: "Mirror Frame", perUnit: null },
      { name: "Hardware Package including cabinet handles", perUnit: 1149.22 },
      { name: "Plumbing fixtures", perUnit: 972.73 },
    ],
  },
  {
    code: "4100",
    name: "Flooring",
    items: [
      { name: "Carpet $1.42/sf", perUnit: null },
      { name: "Vinyl with take-up $4/sf", perUnit: 675.77 },
      { name: "Demo ceramic tile $2.25/sf", perUnit: null },
      { name: "Floor trim", perUnit: null },
    ],
  },
  {
    code: "4200",
    name: "Paint",
    items: [
      { name: "Full paint & color change (includes misc., repairs)", perUnit: 1813.14 },
      { name: "Full Paint - No color change", perUnit: null },
    ],
  },
  {
    code: "4300",
    name: "Other",
    items: [
      { name: "Cabinet/Mud Room/Drop Zone", perUnit: 215.4 },
      { name: "Resurface tub/Shower", perUnit: null },
      { name: "New Bath/Shower Tile", perUnit: null },
      { name: "Shower Door Assembly", perUnit: null },
      { name: "Tech Package", perUnit: null },
      { name: "General Conditions", perUnit: null },
      { name: "Cleaning", perUnit: 230.94 },
      { name: "In-house or third party labor", perUnit: 705.8 },
    ],
  },
  {
    code: "4400",
    name: "Interior Soft Costs",
    items: [
      { name: "Interior CM / Supervision (5%)", perUnit: 453.94 },
      { name: "Interior Contingency (7%)", perUnit: 635.51 },
    ],
  },
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (.env.local)");
  const client = postgres(url, { prepare: false, ssl: "require" });
  const db = drizzle(client);

  const [chart] = await db
    .select({ id: chartsOfAccounts.id })
    .from(chartsOfAccounts)
    .where(eq(chartsOfAccounts.name, "Rockport"));
  if (!chart) throw new Error('Rockport chart not found — run seed-aston-post-oak.ts first.');

  const [property] = await db
    .select({ id: properties.id })
    .from(properties)
    .where(eq(properties.name, "Aston Post Oak"));
  if (!property) throw new Error("Aston Post Oak property not found.");

  // Idempotency guard: bail if any interiors-division category already exists.
  const existingInterior = await db
    .select({ id: costCategories.id })
    .from(costCategories)
    .where(and(eq(costCategories.chartId, chart.id), eq(costCategories.division, "interiors")));
  if (existingInterior.length > 0) {
    throw new Error("Rockport already has interior categories — aborting to avoid duplicates.");
  }

  // Continue sortOrder after the existing (exterior) categories.
  const existingCats = await db
    .select({ id: costCategories.id })
    .from(costCategories)
    .where(eq(costCategories.chartId, chart.id));
  let sortOrder = existingCats.length;

  let categoryCount = 0;
  let codeCount = 0;
  let budgetLineCount = 0;
  let interiorTotal = 0;

  for (const cat of CATEGORIES) {
    const [catRow] = await db
      .insert(costCategories)
      .values({ chartId: chart.id, code: cat.code, name: cat.name, division: "interiors", sortOrder })
      .returning({ id: costCategories.id });
    sortOrder++;
    categoryCount++;

    for (const [j, item] of cat.items.entries()) {
      const subCode = `${cat.code}-${String(j + 1).padStart(4, "0")}`;
      const [codeRow] = await db
        .insert(costCodes)
        .values({
          chartId: chart.id,
          categoryId: catRow.id,
          code: subCode,
          name: item.name,
          isInterior: true,
        })
        .returning({ id: costCodes.id });
      codeCount++;

      if (item.perUnit != null && item.perUnit > 0) {
        const uw = item.perUnit * UNIT_COUNT;
        await db.insert(budgetLines).values({
          propertyId: property.id,
          costCodeId: codeRow.id,
          perUnitAmount: item.perUnit.toFixed(2),
          plannedUnits: UNIT_COUNT,
          uwAmount: uw.toFixed(2),
        });
        budgetLineCount++;
        interiorTotal += uw;
      }
    }
  }

  await client.end();
  console.log(`Rockport chart (id ${chart.id}) extended with the Interiors division.`);
  console.log(`  ${categoryCount} interior categories, ${codeCount} interior cost codes.`);
  console.log(`Aston Post Oak (id ${property.id}) interior budget loaded.`);
  console.log(`  ${budgetLineCount} budget lines, interior total $${Math.round(interiorTotal).toLocaleString()}.`);
  console.log(`  Combined property budget ≈ $${(4599900 + interiorTotal).toLocaleString()}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

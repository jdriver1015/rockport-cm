/**
 * One-time seed: creates the "Rockport" chart of accounts (built directly
 * from the section headers and line items of the Aston Post Oak exterior
 * capex budget), sets it as the portfolio default, creates the Aston Post
 * Oak property bound to it, and populates its budget from the workbook's
 * dollar figures.
 *
 * Source: Aston Post Oak - Final UW Capex Budget - Exterior.xlsx
 * Run: npx tsx scripts/seed-aston-post-oak.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import {
  budgetLines,
  chartsOfAccounts,
  costCategories,
  costCodes,
  properties,
} from "../src/db/schema";

type Item = { name: string; amount: number };
type Category = { code: string; name: string; division: string; items: Item[] };

const CATEGORIES: Category[] = [
  {
    code: "1000",
    name: "Deferred & Preventative Maintenance",
    division: "exterior",
    items: [
      { name: "Foundation", amount: 0 },
      { name: "Roof", amount: 886900 },
      { name: "Garage", amount: 756000 },
      { name: "Parking Lot", amount: 0 },
    ],
  },
  {
    code: "1100",
    name: "Exterior",
    division: "exterior",
    items: [
      { name: "Gutters", amount: 30000 },
      { name: "Siding and Trim", amount: 60000 },
      { name: "Exterior Paint", amount: 457000 },
      { name: "Façade Replacement", amount: 200000 },
      { name: "Railings", amount: 0 },
      { name: "Balconies", amount: 45000 },
      { name: "Signage", amount: 200000 },
      { name: "Bldg. Lighting", amount: 78400 },
      { name: "Fire Safety", amount: 50000 },
      { name: "Elevators", amount: 75000 },
      { name: "Windows", amount: 85000 },
    ],
  },
  {
    code: "1600",
    name: "Landscaping",
    division: "amenities",
    items: [
      { name: "Fireplace", amount: 14000 },
      { name: "Irrigation", amount: 15000 },
      { name: "Tree Trimming", amount: 0 },
      { name: "Drainage", amount: 0 },
      { name: "Frontage", amount: 50000 },
      { name: "Artificial Turf", amount: 50000 },
      { name: "Other Landscaping", amount: 20000 },
    ],
  },
  {
    code: "1700",
    name: "Clubhouse Renovation",
    division: "amenities",
    items: [
      { name: "Clubhouse Remodel", amount: 30000 },
      { name: "Clubhouse Furniture", amount: 50000 },
      { name: "Fitness Equipment", amount: 10000 },
    ],
  },
  {
    code: "1800",
    name: "Pool Area & Amenity Zones",
    division: "amenities",
    items: [
      { name: "Pool Repairs", amount: 55000 },
      { name: "Pool Enhancement", amount: 0 },
      { name: "Pool Furniture", amount: 125000 },
      { name: "Outdoor Kitchen / Pergola", amount: 100000 },
      { name: "Pet Park", amount: 12000 },
    ],
  },
  {
    code: "1900",
    name: "Other Building Amenities",
    division: "amenities",
    items: [
      { name: "Access Control / Gates", amount: 25000 },
      { name: "Tech Package", amount: 352800 },
      { name: "Washer / Dryer", amount: 100000 },
    ],
  },
  {
    code: "3000",
    name: "Start Up Costs",
    division: "fees",
    items: [
      { name: "Maintenance Equipment", amount: 15000 },
      { name: "Startup Costs", amount: 85000 },
    ],
  },
  {
    code: "3100",
    name: "Soft Costs & Other Misc",
    division: "fees",
    items: [
      { name: "General Conditions", amount: 0 },
      { name: "Temp Office", amount: 0 },
      { name: "HVACs", amount: 75000 },
      { name: "Designer", amount: 30000 },
      { name: "Model FFE", amount: 40000 },
      { name: "Oversight", amount: 206000 },
    ],
  },
  {
    code: "3200",
    name: "Contingency",
    division: "fees",
    items: [{ name: "Contingency - Hard Costs", amount: 216800 }],
  },
];

const PROPERTY_NAME = "Aston Post Oak";
const UNIT_COUNT = 392;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (.env.local)");
  const client = postgres(url, { prepare: false, ssl: "require" });
  const db = drizzle(client);

  const existingChart = await db
    .select({ id: chartsOfAccounts.id })
    .from(chartsOfAccounts)
    .where(eq(chartsOfAccounts.name, "Rockport"));
  if (existingChart.length > 0) {
    throw new Error('A chart named "Rockport" already exists — aborting to avoid duplicates.');
  }

  const [chart] = await db
    .insert(chartsOfAccounts)
    .values({
      name: "Rockport",
      description: "Default chart of accounts, seeded from the Aston Post Oak exterior capex budget.",
      isDefault: false,
    })
    .returning({ id: chartsOfAccounts.id });

  await db.update(chartsOfAccounts).set({ isDefault: false }).where(eq(chartsOfAccounts.isDefault, true));
  await db.update(chartsOfAccounts).set({ isDefault: true }).where(eq(chartsOfAccounts.id, chart.id));

  let categoryCount = 0;
  let codeCount = 0;
  let budgetLineCount = 0;
  let budgetTotal = 0;

  const [property] = await db
    .insert(properties)
    .values({
      name: PROPERTY_NAME,
      chartOfAccountsId: chart.id,
      unitCount: UNIT_COUNT,
    })
    .returning({ id: properties.id });

  for (const [i, cat] of CATEGORIES.entries()) {
    const [catRow] = await db
      .insert(costCategories)
      .values({ chartId: chart.id, code: cat.code, name: cat.name, division: cat.division, sortOrder: i })
      .returning({ id: costCategories.id });
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
          isInterior: false,
        })
        .returning({ id: costCodes.id });
      codeCount++;

      if (item.amount > 0) {
        await db.insert(budgetLines).values({
          propertyId: property.id,
          costCodeId: codeRow.id,
          uwAmount: item.amount.toFixed(2),
        });
        budgetLineCount++;
        budgetTotal += item.amount;
      }
    }
  }

  await client.end();
  console.log(`Chart "Rockport" created — id ${chart.id}, set as portfolio default.`);
  console.log(`  ${categoryCount} categories, ${codeCount} cost codes.`);
  console.log(`Property "${PROPERTY_NAME}" created — id ${property.id}, ${UNIT_COUNT} units.`);
  console.log(`  ${budgetLineCount} budget lines, total $${budgetTotal.toLocaleString()}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

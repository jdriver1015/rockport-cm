/**
 * Lexington at Champions import, step 2 of 4: loads the full 89-unit roster
 * (Home Details) and creates the 10 already-completed unit-turn projects
 * (Unit Tracker), each with its per-cost-code scope breakdown.
 *
 * Run after seed-lexington-coa-budget.ts (needs its cost codes).
 * Run: npx tsx scripts/seed-lexington-units.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { costCodes, projects, projectStageEvents, scopeItems, units } from "../src/db/schema";
import {
  CHART_ID,
  FLOORPLAN_SPECS,
  LEGACY_CODE_MAP,
  PROPERTY_ID,
  excelSerialToISO,
  loadWorkbook,
  parseHomeDetails,
  parseUnitTracker,
} from "./lexington-workbook";

// Unit Tracker's category names use the same legacy naming as Cost Code Bank
// minus the numeric prefix; map by name since these sub-lines have no code.
const CATEGORY_NAME_TO_LEGACY_CODE: Record<string, string> = {
  "Interior Paint - Renovation": "15671",
  "Interior Countertops - Renovation": "15673",
  "Interior Cabinets - Renovation": "15674",
  "Interior Backsplash - Renovation": "15675",
  "Interior Fixtures - Renovation": "15676",
  "Interior Labor - Renovation": "15677",
  "Interior Miscellaneous - Renovation": "15678",
  "Interior Appliances - Renovations": "15679",
  "Interior Carpet- Renovation": "15621",
  "Interior Hard Surface Flooring - Renovation": "15631",
};

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (.env.local)");
  const client = postgres(url, { prepare: false, ssl: "require" });
  const db = drizzle(client);

  const existing = await db.select({ id: units.id }).from(units).where(eq(units.propertyId, PROPERTY_ID));
  if (existing.length > 0) {
    throw new Error(`Property ${PROPERTY_ID} already has units — aborting to avoid duplicates.`);
  }

  const wb = loadWorkbook();
  const roster = parseHomeDetails(wb);
  const tracked = parseUnitTracker(wb);

  const allCodes = await db
    .select({ id: costCodes.id, code: costCodes.code })
    .from(costCodes)
    .where(eq(costCodes.chartId, CHART_ID));
  const idByCode = new Map(allCodes.map((c) => [c.code, c.id]));

  // 1. Full unit roster.
  const unitIdByNumber = new Map<string, number>();
  for (const r of roster) {
    const spec = FLOORPLAN_SPECS[r.floorplan];
    const [row] = await db
      .insert(units)
      .values({
        propertyId: PROPERTY_ID,
        unitNumber: r.unitNumber,
        floorplan: r.floorplan,
        bedrooms: spec?.bedrooms ?? null,
        sqft: spec?.sqft ?? null,
      })
      .returning({ id: units.id, unitNumber: units.unitNumber });
    unitIdByNumber.set(row.unitNumber, row.id);
  }

  // 2. The 10 tracked unit-turn projects.
  let projectCount = 0;
  let scopeItemCount = 0;
  for (const u of tracked) {
    const unitId = unitIdByNumber.get(u.unitNumber);
    if (!unitId) throw new Error(`Unit ${u.unitNumber} from Unit Tracker not found in Home Details roster`);

    const [project] = await db
      .insert(projects)
      .values({
        propertyId: PROPERTY_ID,
        name: `Unit ${u.unitNumber} Turn`,
        kind: "unit",
        unitId,
        stage: "closed", // all 10 are Completed + Invoiced + leased
        budgetAmount: u.budget.toFixed(2),
        committedCost: u.actual.toFixed(2),
        startDate: excelSerialToISO(u.start),
        completeDate: excelSerialToISO(u.complete),
        previousRent: u.previousRent != null ? u.previousRent.toFixed(2) : null,
        tradeOutRent: u.tradeOutRent != null ? u.tradeOutRent.toFixed(2) : null,
        inPlaceRent: u.inPlaceRent != null ? u.inPlaceRent.toFixed(2) : null,
        leaseDate: excelSerialToISO(u.dateLeased),
      })
      .returning({ id: projects.id });
    projectCount++;

    await db.insert(projectStageEvents).values({ projectId: project.id, toStage: "closed" });

    for (const line of u.lines) {
      const legacyCode = CATEGORY_NAME_TO_LEGACY_CODE[line.category];
      const targetCode = legacyCode ? LEGACY_CODE_MAP[legacyCode] : undefined;
      const costCodeId = targetCode ? idByCode.get(targetCode) : undefined;
      await db.insert(scopeItems).values({
        projectId: project.id,
        item: line.category,
        costCodeId: costCodeId ?? null,
        pricingMethod: "fixed",
        unitPrice: line.actual.toFixed(2),
        quantity: "1",
      });
      scopeItemCount++;
    }
  }

  await client.end();
  console.log(`${unitIdByNumber.size} units created for property ${PROPERTY_ID}.`);
  console.log(`${projectCount} unit-turn projects created, ${scopeItemCount} scope items.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

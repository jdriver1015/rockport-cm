/**
 * Lexington at Champions import, step 1 of 4: adds the one missing cost code,
 * loads the property's budget (UW Cost column), and seeds mapping rules so the
 * GL import (step 4) can auto-resolve every legacy cost code.
 *
 * Source: Lexington at Champions - Construction Tracker.xlsx
 * Run: npx tsx scripts/seed-lexington-coa-budget.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq } from "drizzle-orm";
import postgres from "postgres";
import { budgetLines, costCategories, costCodes, mappingRules } from "../src/db/schema";
import { BUDGET_LINES, CHART_ID, LEGACY_CODE_MAP, NEW_CODE, PROPERTY_ID } from "./lexington-workbook";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (.env.local)");
  const client = postgres(url, { prepare: false, ssl: "require" });
  const db = drizzle(client);

  const existingLegacyRule = await db
    .select({ id: mappingRules.id })
    .from(mappingRules)
    .where(and(eq(mappingRules.chartId, CHART_ID), eq(mappingRules.pattern, "15571")));
  if (existingLegacyRule.length > 0) {
    throw new Error('A mapping rule for "15571" already exists — aborting to avoid duplicates.');
  }

  // 1. New cost code.
  const [category] = await db
    .select({ id: costCategories.id })
    .from(costCategories)
    .where(and(eq(costCategories.chartId, CHART_ID), eq(costCategories.code, NEW_CODE.categoryCode)));
  if (!category) throw new Error(`Category ${NEW_CODE.categoryCode} not found on chart ${CHART_ID}`);

  const [newCode] = await db
    .insert(costCodes)
    .values({
      chartId: CHART_ID,
      categoryId: category.id,
      code: NEW_CODE.code,
      name: NEW_CODE.name,
      isInterior: false,
    })
    .returning({ id: costCodes.id, code: costCodes.code });

  // 2. Resolve every target code (existing + the one just created) to its id.
  const allCodes = await db
    .select({ id: costCodes.id, code: costCodes.code })
    .from(costCodes)
    .where(eq(costCodes.chartId, CHART_ID));
  const idByCode = new Map(allCodes.map((c) => [c.code, c.id]));

  // 3. Budget lines.
  let budgetTotal = 0;
  for (const line of BUDGET_LINES) {
    const costCodeId = idByCode.get(line.code);
    if (!costCodeId) throw new Error(`Cost code ${line.code} not found — aborting`);
    await db.insert(budgetLines).values({
      propertyId: PROPERTY_ID,
      costCodeId,
      uwAmount: line.uwAmount.toFixed(2),
    });
    budgetTotal += line.uwAmount;
  }

  // 4. Mapping rules — priority 5 so these exact legacy-code matches take
  // precedence over the chart's existing keyword/vendor rules (priority >= 10).
  let ruleCount = 0;
  for (const [legacyCode, targetCode] of Object.entries(LEGACY_CODE_MAP)) {
    const costCodeId = idByCode.get(targetCode);
    if (!costCodeId) throw new Error(`Cost code ${targetCode} not found for legacy code ${legacyCode}`);
    await db.insert(mappingRules).values({
      chartId: CHART_ID,
      matchType: "gl_account",
      pattern: legacyCode,
      costCodeId,
      priority: 5,
    });
    ruleCount++;
  }

  await client.end();
  console.log(`New cost code ${newCode.code} (id ${newCode.id}) created under category ${NEW_CODE.categoryCode}.`);
  console.log(`${BUDGET_LINES.length} budget lines loaded for property ${PROPERTY_ID}, total $${budgetTotal.toLocaleString()}.`);
  console.log(`${ruleCount} mapping rules seeded (gl_account, priority 5).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

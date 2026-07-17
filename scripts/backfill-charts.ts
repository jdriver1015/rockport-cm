/**
 * One-time backfill for multi-chart support. Creates a single default chart
 * ("Westcreek Standard") and stamps every existing category, cost code, mapping
 * rule, and property with it, so the pre-multi-chart data keeps working exactly
 * as before. Idempotent — safe to re-run; only fills rows whose chart is null.
 *
 * Run: npx tsx scripts/backfill-charts.ts
 *
 * After this succeeds, a second migration sets the chart columns NOT NULL.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { drizzle } from "drizzle-orm/postgres-js";
import { eq, isNull } from "drizzle-orm";
import postgres from "postgres";
import {
  chartsOfAccounts,
  costCategories,
  costCodes,
  mappingRules,
  properties,
} from "../src/db/schema";

const DEFAULT_CHART_NAME = "Westcreek Standard";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (.env.local)");
  const client = postgres(url, { prepare: false, ssl: "require" });
  const db = drizzle(client);

  // 1. Ensure the default chart exists.
  const existing = await db
    .select()
    .from(chartsOfAccounts)
    .where(eq(chartsOfAccounts.name, DEFAULT_CHART_NAME));
  let chart = existing[0];
  if (!chart) {
    const [created] = await db
      .insert(chartsOfAccounts)
      .values({
        name: DEFAULT_CHART_NAME,
        description: "Portfolio standard chart (migrated from the original single chart).",
        isDefault: true,
      })
      .returning();
    chart = created;
    console.log(`Created default chart #${chart.id} "${chart.name}"`);
  } else {
    console.log(`Default chart already exists: #${chart.id} "${chart.name}"`);
  }
  const chartId = chart.id;

  // 2. Stamp categories, codes, mapping rules, properties where chart is null.
  const cat = await db
    .update(costCategories)
    .set({ chartId })
    .where(isNull(costCategories.chartId))
    .returning({ id: costCategories.id });
  console.log(`Stamped ${cat.length} cost_categories`);

  const code = await db
    .update(costCodes)
    .set({ chartId })
    .where(isNull(costCodes.chartId))
    .returning({ id: costCodes.id });
  console.log(`Stamped ${code.length} cost_codes`);

  const rule = await db
    .update(mappingRules)
    .set({ chartId })
    .where(isNull(mappingRules.chartId))
    .returning({ id: mappingRules.id });
  console.log(`Stamped ${rule.length} mapping_rules`);

  const prop = await db
    .update(properties)
    .set({ chartOfAccountsId: chartId })
    .where(isNull(properties.chartOfAccountsId))
    .returning({ id: properties.id });
  console.log(`Stamped ${prop.length} properties`);

  await client.end();
  console.log("Backfill complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

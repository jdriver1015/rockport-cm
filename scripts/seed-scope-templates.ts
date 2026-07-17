/**
 * Seeds a starter library of interior renovation templates under Settings →
 * Scope Groups. These are the base options offered when creating a per-property
 * scope group. Pricing is placeholder — tune it in the UI.
 *
 * Idempotent — a template whose name already exists is left untouched.
 * Run: npx tsx scripts/seed-scope-templates.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { scopeGroupTemplates, scopeGroupTemplateItems } from "../src/db/schema";
import type { PricingMethod } from "../src/lib/pricing";

type Item = {
  name: string;
  category: string;
  pricingMethod: PricingMethod;
  unitPrice: number;
  defaultQuantity?: number;
  costCodeRef: string;
};

const TEMPLATES: { name: string; description: string; items: Item[] }[] = [
  {
    name: "Classic Refresh",
    description: "Light turn: paint, flooring, and fixtures.",
    items: [
      { name: "Interior Paint", category: "Paint", pricingMethod: "sqft", unitPrice: 1.85, costCodeRef: "4000-0001" },
      { name: "Flooring", category: "Flooring", pricingMethod: "sqft", unitPrice: 3.25, costCodeRef: "4000-0002" },
      { name: "Fixtures", category: "Fixtures", pricingMethod: "fixed", unitPrice: 450, costCodeRef: "4000-0007" },
      { name: "Miscellaneous", category: "Misc", pricingMethod: "fixed", unitPrice: 500, costCodeRef: "4000-0009" },
    ],
  },
  {
    name: "Standard Upgrade",
    description: "Paint, flooring, appliances, countertops, fixtures, labor.",
    items: [
      { name: "Interior Paint", category: "Paint", pricingMethod: "sqft", unitPrice: 1.85, costCodeRef: "4000-0001" },
      { name: "Flooring", category: "Flooring", pricingMethod: "sqft", unitPrice: 3.25, costCodeRef: "4000-0002" },
      { name: "Appliances", category: "Appliances", pricingMethod: "fixed", unitPrice: 2200, costCodeRef: "4000-0003" },
      { name: "Countertops", category: "Countertops", pricingMethod: "fixed", unitPrice: 1200, costCodeRef: "4000-0004" },
      { name: "Fixtures", category: "Fixtures", pricingMethod: "fixed", unitPrice: 450, costCodeRef: "4000-0007" },
      { name: "Labor", category: "Labor", pricingMethod: "fixed", unitPrice: 1500, costCodeRef: "4000-0008" },
    ],
  },
  {
    name: "Premium Upgrade",
    description: "Full renovation: adds backsplash and cabinet doors.",
    items: [
      { name: "Interior Paint", category: "Paint", pricingMethod: "sqft", unitPrice: 1.85, costCodeRef: "4000-0001" },
      { name: "Flooring", category: "Flooring", pricingMethod: "sqft", unitPrice: 3.75, costCodeRef: "4000-0002" },
      { name: "Appliances", category: "Appliances", pricingMethod: "fixed", unitPrice: 3200, costCodeRef: "4000-0003" },
      { name: "Countertops", category: "Countertops", pricingMethod: "fixed", unitPrice: 1800, costCodeRef: "4000-0004" },
      { name: "Kitchen Backsplash", category: "Backsplash", pricingMethod: "fixed", unitPrice: 650, costCodeRef: "4000-0005" },
      { name: "Cabinet Doors", category: "Cabinets", pricingMethod: "fixed", unitPrice: 1800, costCodeRef: "4000-0006" },
      { name: "Fixtures", category: "Fixtures", pricingMethod: "fixed", unitPrice: 650, costCodeRef: "4000-0007" },
      { name: "Labor", category: "Labor", pricingMethod: "fixed", unitPrice: 2200, costCodeRef: "4000-0008" },
    ],
  },
  {
    name: "Make Ready",
    description: "Turn a unit for the next resident: paint, flooring, cleanup.",
    items: [
      { name: "Interior Paint", category: "Paint", pricingMethod: "sqft", unitPrice: 1.65, costCodeRef: "4000-0001" },
      { name: "Flooring", category: "Flooring", pricingMethod: "sqft", unitPrice: 2.95, costCodeRef: "4000-0002" },
      { name: "Miscellaneous", category: "Misc", pricingMethod: "fixed", unitPrice: 350, costCodeRef: "4000-0009" },
    ],
  },
  {
    name: "Flooring Only",
    description: "Flooring replacement across the unit.",
    items: [
      { name: "Flooring", category: "Flooring", pricingMethod: "sqft", unitPrice: 3.25, costCodeRef: "4000-0002" },
    ],
  },
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (.env.local)");
  const client = postgres(url, { prepare: false, ssl: "require" });
  const db = drizzle(client);

  let created = 0;
  for (const [i, tpl] of TEMPLATES.entries()) {
    const existing = await db
      .select({ id: scopeGroupTemplates.id })
      .from(scopeGroupTemplates)
      .where(eq(scopeGroupTemplates.name, tpl.name));
    if (existing.length > 0) {
      console.log(`  "${tpl.name}" already exists — skipping`);
      continue;
    }
    const [row] = await db
      .insert(scopeGroupTemplates)
      .values({ name: tpl.name, description: tpl.description, sortOrder: i })
      .returning({ id: scopeGroupTemplates.id });
    await db.insert(scopeGroupTemplateItems).values(
      tpl.items.map((it, j) => ({
        templateId: row.id,
        name: it.name,
        category: it.category,
        pricingMethod: it.pricingMethod,
        unitPrice: it.unitPrice.toFixed(2),
        defaultQuantity: it.defaultQuantity != null ? it.defaultQuantity.toFixed(2) : null,
        costCodeRef: it.costCodeRef,
        sortOrder: j,
      })),
    );
    created++;
    console.log(`  Created "${tpl.name}" with ${tpl.items.length} items`);
  }

  await client.end();
  console.log(`Done — ${created} template(s) created.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

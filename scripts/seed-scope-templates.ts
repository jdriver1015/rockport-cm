/**
 * Seeds a starter library of interior renovation templates under Settings →
 * Interior Scope Groups. These are the base options offered when creating a
 * per-property scope group. Pricing is placeholder — tune it in the UI.
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
    name: "Enhanced",
    description: "Mid-tier interior turn.",
    items: [],
  },
  {
    name: "Signature",
    description: "Top-tier interior turn.",
    items: [],
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

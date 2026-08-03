/**
 * Seeds the two standard budget templates under Settings → Budget Templates:
 * "Enhanced" (mid-tier turn) and "Signature" (top-tier turn). Each template has
 * one budget line per cost code, with scope descriptions collapsed into notes.
 *
 * Idempotent — a template that already has lines is left untouched; an existing
 * empty template gets its lines seeded.
 * Run: npx tsx scripts/seed-budget-templates.ts
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { budgetTemplates, budgetTemplateLines } from "../src/db/schema";

type Line = {
  costCodeRef: string;
  pricingMethod?: string;
  notes: string;
};

const ENHANCED_LINES: Line[] = [
  { costCodeRef: "4000-0001", notes: "Paint interior — walls, doors, & trim, 3-tone color scheme. Drywall footprint repairs." },
  { costCodeRef: "4000-0002", notes: "R&R carpet in bedrooms & associated closets only. Includes minor floor prep." },
  { costCodeRef: "4000-0003", notes: "R&Reset refrigerator, range, & dishwasher for paint prep." },
  { costCodeRef: "4000-0005", notes: "Install kitchen tile backsplash below upper cabinets w/ metal edging. Includes behind range." },
  { costCodeRef: "4000-0006", notes: "R&R cabinet door & drawer pulls. See alternates for cabinet painting." },
  { costCodeRef: "4000-0007", notes: "R&R kitchen light, pendant light, undercabinet lighting, kitchen faucet, kitchen sink, mirror frame." },
  { costCodeRef: "4000-0009", notes: "Final clean." },
];

const SIGNATURE_LINES: Line[] = [
  { costCodeRef: "4000-0001", notes: "Paint interior — walls, doors, & trim, 3-tone color scheme. Drywall footprint repairs." },
  { costCodeRef: "4000-0002", notes: "R&R flooring throughout w/ new glue-down LVP plank — entire unit complete." },
  { costCodeRef: "4000-0003", notes: "R&R refrigerator, range, microhood, & dishwasher. R&Reset washer & dryer." },
  { costCodeRef: "4000-0004", notes: "R&R kitchen countertops — 2cm Level I quartz. R&R bath countertops w/ back & sidesplash." },
  { costCodeRef: "4000-0005", notes: "Install kitchen tile backsplash — Daltile Zellige Neo Lana ZL07 3x12, horizontal stacked." },
  { costCodeRef: "4000-0006", notes: "R&R cabinet door & drawer pulls. See alternates for new doors/fronts and cabinet painting." },
  { costCodeRef: "4000-0007", notes: "R&R kitchen light, pendants, vanity lights, flushmounts, ceiling fans, recessed lights, faucets, sinks, door hardware, bath accessories, mirrors." },
  { costCodeRef: "4000-0009", notes: "Demo / trash / appliance haul-off. Final clean." },
];

const TEMPLATES: { name: string; description: string; lines: Line[] }[] = [
  { name: "Enhanced", description: "Mid-tier interior turn.", lines: ENHANCED_LINES },
  { name: "Signature", description: "Top-tier interior turn.", lines: SIGNATURE_LINES },
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (.env.local)");
  const client = postgres(url, { prepare: false, ssl: "require" });
  const db = drizzle(client);

  for (const [i, tpl] of TEMPLATES.entries()) {
    const existing = await db
      .select({ id: budgetTemplates.id })
      .from(budgetTemplates)
      .where(eq(budgetTemplates.name, tpl.name));

    let templateId: number;
    if (existing.length > 0) {
      templateId = existing[0].id;
      const lines = await db
        .select({ id: budgetTemplateLines.id })
        .from(budgetTemplateLines)
        .where(eq(budgetTemplateLines.templateId, templateId));
      if (lines.length > 0) {
        console.log(`  "${tpl.name}" already has ${lines.length} lines — skipping`);
        continue;
      }
      console.log(`  "${tpl.name}" exists and is empty — seeding lines`);
    } else {
      const [row] = await db
        .insert(budgetTemplates)
        .values({ name: tpl.name, description: tpl.description, sortOrder: i })
        .returning({ id: budgetTemplates.id });
      templateId = row.id;
      console.log(`  Created "${tpl.name}"`);
    }

    await db.insert(budgetTemplateLines).values(
      tpl.lines.map((ln, j) => ({
        templateId,
        costCodeRef: ln.costCodeRef,
        pricingMethod: (ln.pricingMethod ?? "fixed") as "fixed",
        notes: ln.notes,
        sortOrder: j,
      })),
    );
    console.log(`  Seeded ${tpl.lines.length} lines into "${tpl.name}"`);
  }

  await client.end();
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

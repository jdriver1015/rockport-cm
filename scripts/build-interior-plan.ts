/**
 * Build an interior budget plan from a property's existing hand-entered interior
 * budget lines.
 *
 * Dry-run by default. Pass --apply to write.
 *
 *   npx tsx scripts/build-interior-plan.ts aston-post-oak
 *   npx tsx scripts/build-interior-plan.ts aston-post-oak --apply
 *
 * What it does:
 *   1. Seeds unit groups from the latest committed rent roll, grouped by beds.
 *   2. Creates ONE upgrade tier from the existing interior lines
 *      (per_unit_amount → unit_price, method `fixed`).
 *   3. Backs the CM/supervision and contingency rates out of the reconstructed
 *      scope subtotal and stores them as plan-level uplift rates, pointed at the
 *      cost codes they came from.
 *   4. Plans every unit into that single tier (100% penetration).
 *
 * THE GATE: the plan-derived interior total must equal the prior hand-entered
 * total to the penny, or nothing is written. A mismatch means the two models
 * disagree about something real — usually the unit count — and silently
 * flipping the property would move the budget.
 *
 * --match-prior-units rescales the planned units so the total ties exactly, for
 * when the prior budget assumed a different unit count than the rent roll shows.
 *
 * The generated tier is a BLENDED AVERAGE of whatever mix the prior budget
 * assumed. Reproducing the total with one 100%-penetration tier is arithmetically
 * right and scope-wise wrong — split it into real tiers afterwards.
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { and, eq, isNull } from "drizzle-orm";
import { db } from "../src/db";
import * as schema from "../src/db/schema";
import { num } from "../src/lib/format";
import { roundMoney } from "../src/lib/pricing";
import { computeInteriorBudgetFor } from "../src/lib/interior-budget";
import { proposeUnitGroups, type FloorplanFacts } from "../src/lib/interior-unit-grouping";

// Short enough to read as a pivot column header; the warning lives in the
// description, not the name.
const TIER_NAME = "Blended UW";
/** Category code whose lines are treated as uplifts rather than scope. */
const SOFT_COST_CATEGORY = "4400";

const args = process.argv.slice(2);
const slug = args.find((a) => !a.startsWith("--")) ?? "aston-post-oak";
const APPLY = args.includes("--apply");
const MATCH_PRIOR_UNITS = args.includes("--match-prior-units");

const money = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Split `target` whole units across `weights` so the parts sum to `target`
 * exactly: floor every share, then hand the leftover units to the largest
 * fractional remainders. Since every group carries the same per-unit total here,
 * a unit count that ties exactly means the dollar total does too.
 */
function apportion(weights: readonly number[], target: number): number[] {
  const totalWeight = weights.reduce((s, w) => s + w, 0);
  if (totalWeight === 0) return weights.map(() => 0);

  const exact = weights.map((w) => (w / totalWeight) * target);
  const out = exact.map(Math.floor);
  let leftover = target - out.reduce((s, f) => s + f, 0);

  const byRemainder = exact
    .map((e, i) => ({ i, frac: e - Math.floor(e) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of byRemainder) {
    if (leftover <= 0) break;
    out[i]++;
    leftover--;
  }
  return out;
}

async function main() {
  const d = db();

  const property = await d.query.properties.findFirst({
    where: eq(schema.properties.slug, slug),
  });
  if (!property) throw new Error(`No property with slug "${slug}"`);
  console.log(`\nProperty: ${property.name} (id ${property.id}, chart ${property.chartOfAccountsId})`);

  // --- 1. existing interior budget lines ----------------------------------
  const priorLines = await d
    .select({
      costCodeId: schema.costCodes.id,
      code: schema.costCodes.code,
      name: schema.costCodes.name,
      categoryCode: schema.costCategories.code,
      perUnitAmount: schema.budgetLines.perUnitAmount,
      plannedUnits: schema.budgetLines.plannedUnits,
      uwAmount: schema.budgetLines.uwAmount,
    })
    .from(schema.budgetLines)
    .innerJoin(schema.costCodes, eq(schema.budgetLines.costCodeId, schema.costCodes.id))
    .innerJoin(schema.costCategories, eq(schema.costCodes.categoryId, schema.costCategories.id))
    .where(
      and(
        eq(schema.budgetLines.propertyId, property.id),
        isNull(schema.budgetLines.archivedAt),
        eq(schema.costCodes.isInterior, true),
      ),
    )
    .orderBy(schema.costCodes.code);

  if (priorLines.length === 0) throw new Error("No interior budget lines to build a plan from");

  const priorTotal = roundMoney(priorLines.reduce((s, l) => s + num(l.uwAmount), 0));
  const scopeLines = priorLines.filter((l) => l.categoryCode !== SOFT_COST_CATEGORY);
  const softLines = priorLines.filter((l) => l.categoryCode === SOFT_COST_CATEGORY);

  const missingPerUnit = scopeLines.filter((l) => l.perUnitAmount == null);
  if (missingPerUnit.length > 0) {
    throw new Error(
      `These interior lines have no per-unit amount, so they can't become tier lines: ${missingPerUnit
        .map((l) => l.code)
        .join(", ")}`,
    );
  }

  const subtotal = roundMoney(scopeLines.reduce((s, l) => s + num(l.perUnitAmount), 0));
  console.log(`\nPrior interior budget: ${money(priorTotal)}`);
  console.log(`  ${scopeLines.length} scope lines · per-unit subtotal ${money(subtotal)}`);

  // --- 2. back the uplift rates out of the subtotal ------------------------
  const findSoft = (needle: string) =>
    softLines.find((l) => l.name.toLowerCase().includes(needle));
  const cmLine = findSoft("supervision") ?? findSoft("cm");
  const contLine = findSoft("contingency");

  const rateOf = (perUnit: number) =>
    subtotal > 0 ? Math.round((perUnit / subtotal) * 100 * 1000) / 1000 : 0;
  const cmPct = cmLine ? rateOf(num(cmLine.perUnitAmount)) : 0;
  const contPct = contLine ? rateOf(num(contLine.perUnitAmount)) : 0;

  console.log(`  ${softLines.length} soft-cost lines:`);
  for (const l of softLines) {
    const which = l === cmLine ? `→ CM ${cmPct}%` : l === contLine ? `→ contingency ${contPct}%` : "→ UNMATCHED";
    console.log(`    ${l.code} ${l.name} · ${money(num(l.perUnitAmount))}/unit ${which}`);
  }
  const unmatched = softLines.filter((l) => l !== cmLine && l !== contLine);
  if (unmatched.length > 0) {
    throw new Error(
      `Soft-cost line(s) ${unmatched.map((l) => l.code).join(", ")} matched neither CM nor contingency — the total can't be reproduced. Rename them or move them out of category ${SOFT_COST_CATEGORY}.`,
    );
  }

  // Confirm the rates round-trip before relying on them.
  const cmPerUnit = roundMoney((cmPct / 100) * subtotal);
  const contPerUnit = roundMoney((contPct / 100) * subtotal);
  for (const [label, line, derived] of [
    ["CM", cmLine, cmPerUnit],
    ["Contingency", contLine, contPerUnit],
  ] as const) {
    if (!line) continue;
    const stored = num(line.perUnitAmount);
    if (Math.abs(stored - derived) > 0.005) {
      throw new Error(
        `${label} rate doesn't round-trip: stored ${money(stored)}/unit vs ${money(derived)} from the derived rate. The prior budget's uplift isn't a clean percentage of the scope subtotal.`,
      );
    }
  }
  const perUnitTotal = roundMoney(subtotal + cmPerUnit + contPerUnit);
  console.log(`  per-unit grand total ${money(perUnitTotal)}`);

  // --- 3. unit groups from the rent roll ----------------------------------
  const [batch] = await d
    .select({ id: schema.rentRollBatches.id, asOfDate: schema.rentRollBatches.asOfDate })
    .from(schema.rentRollBatches)
    .where(
      and(
        eq(schema.rentRollBatches.propertyId, property.id),
        eq(schema.rentRollBatches.status, "committed"),
        isNull(schema.rentRollBatches.archivedAt),
      ),
    )
    .orderBy(schema.rentRollBatches.asOfDate)
    .limit(1);
  if (!batch) throw new Error("No committed rent roll — can't seed unit groups");

  const rrUnits = await d
    .select({
      floorPlanCode: schema.rentRollUnits.floorPlanCode,
      squareFeet: schema.rentRollUnits.squareFeet,
      beds: schema.rentRollUnits.beds,
      baths: schema.rentRollUnits.baths,
    })
    .from(schema.rentRollUnits)
    .where(eq(schema.rentRollUnits.batchId, batch.id));

  const acc = new Map<string, { count: number; sqft: number; sqftN: number; beds: Map<number, number>; baths: Map<number, number> }>();
  for (const u of rrUnits) {
    const key = u.floorPlanCode ?? "";
    const a = acc.get(key) ?? { count: 0, sqft: 0, sqftN: 0, beds: new Map(), baths: new Map() };
    a.count++;
    if (u.squareFeet != null) { a.sqft += u.squareFeet; a.sqftN++; }
    if (u.beds != null) a.beds.set(u.beds, (a.beds.get(u.beds) ?? 0) + 1);
    if (u.baths != null) { const b = num(u.baths); a.baths.set(b, (a.baths.get(b) ?? 0) + 1); }
    acc.set(key, a);
  }
  const modeOf = (m: Map<number, number>) => {
    let best: number | null = null, bestC = -1;
    for (const [v, c] of m) if (c > bestC) { best = v; bestC = c; }
    return best;
  };
  const facts: FloorplanFacts[] = [...acc.entries()].map(([floorPlanCode, a]) => ({
    floorPlanCode,
    count: a.count,
    avgSqft: a.sqftN > 0 ? Math.round((a.sqft / a.sqftN) * 100) / 100 : null,
    bedrooms: modeOf(a.beds),
    baths: modeOf(a.baths),
  }));

  const proposed = proposeUnitGroups(facts);
  const countFor = (codes: readonly string[]) =>
    codes.reduce((s, c) => s + (acc.get(c)?.count ?? 0), 0);
  const rentRollUnitTotal = rrUnits.length;

  console.log(`\nRent roll ${batch.asOfDate ?? ""} — ${rentRollUnitTotal} units → ${proposed.length} groups:`);
  for (const g of proposed) console.log(`  ${g.name}: ${countFor(g.floorPlanCodes)} units, ${g.floorPlanCodes.length} floorplans`);

  // --- 4. the gate --------------------------------------------------------
  const priorUnits = priorLines[0].plannedUnits ?? rentRollUnitTotal;
  const rentRollCounts = proposed.map((g) => countFor(g.floorPlanCodes));
  let plannedCounts = rentRollCounts;
  let plannedTotal = rentRollUnitTotal;

  if (MATCH_PRIOR_UNITS && priorUnits !== rentRollUnitTotal) {
    // Apportion the prior budget's unit count across groups by largest remainder.
    // Planned units are whole, so scaling each group independently and rounding
    // would drift off `priorUnits` and fail the penny-exact gate below; the
    // remainder pass puts the leftover units back one at a time.
    plannedCounts = apportion(rentRollCounts, priorUnits);
    plannedTotal = priorUnits;
    console.log(
      `\n--match-prior-units: apportioning ${rentRollUnitTotal} rent-roll units to the prior budget's ${priorUnits}`,
    );
  }

  const expected = roundMoney(
    plannedCounts.reduce((s, units) => s + roundMoney(perUnitTotal * units), 0),
  );
  const delta = roundMoney(expected - priorTotal);

  console.log(`\nGATE`);
  console.log(`  prior hand-entered total : ${money(priorTotal)}  (${priorUnits} units assumed)`);
  console.log(`  plan-derived total       : ${money(expected)}  (${plannedTotal} units planned)`);
  console.log(`  delta                    : ${money(delta)}`);

  if (delta !== 0) {
    console.log(`\n✗ GATE FAILED — refusing to write.`);
    if (priorUnits !== rentRollUnitTotal) {
      console.log(
        `  The prior budget assumed ${priorUnits} units; the rent roll has ${rentRollUnitTotal}. ` +
          `That accounts for ${money(roundMoney(perUnitTotal * (priorUnits - plannedTotal)))} of the delta.`,
      );
      console.log(`  Either fix the unit count, or re-run with --match-prior-units to tie exactly.`);
    }
    process.exit(1);
  }
  console.log(`  ✓ ties to the penny`);

  if (!APPLY) {
    console.log(`\nDry run — nothing written. Re-run with --apply to commit.\n`);
    await closeDb();
    return;
  }

  // --- 5. write -----------------------------------------------------------
  const existingTier = await d.query.budgetGroups.findFirst({
    where: and(eq(schema.budgetGroups.propertyId, property.id), eq(schema.budgetGroups.name, TIER_NAME)),
  });
  if (existingTier) throw new Error(`"${TIER_NAME}" already exists — delete it before re-running`);

  const existingGroups = await d
    .select({ id: schema.interiorUnitGroups.id })
    .from(schema.interiorUnitGroups)
    .where(eq(schema.interiorUnitGroups.propertyId, property.id));
  if (existingGroups.length > 0) {
    throw new Error(
      `This property already has ${existingGroups.length} unit group(s). This script only builds an initial plan; adjust from the Budget tab instead.`,
    );
  }

  await d.transaction(async (tx) => {
    const [tier] = await tx
      .insert(schema.budgetGroups)
      .values({
        propertyId: property.id,
        name: TIER_NAME,
        description: `Generated from ${scopeLines.length} hand-entered interior budget lines. Blended across whatever upgrade mix the prior budget assumed — split into real tiers.`,
        sortOrder: 0,
      })
      .returning({ id: schema.budgetGroups.id });

    await tx.insert(schema.budgetGroupLines).values(
      scopeLines.map((l, i) => ({
        budgetGroupId: tier.id,
        costCodeId: l.costCodeId,
        pricingMethod: "fixed" as const,
        unitPrice: num(l.perUnitAmount).toFixed(2),
        sortOrder: i,
      })),
    );

    let order = 0;
    for (const [gi, g] of proposed.entries()) {
      const [row] = await tx
        .insert(schema.interiorUnitGroups)
        .values({
          propertyId: property.id,
          name: g.name,
          bedrooms: g.bedrooms,
          baths: g.baths != null ? g.baths.toFixed(1) : null,
          sourceBatchId: batch.id,
          sortOrder: order++,
        })
        .returning({ id: schema.interiorUnitGroups.id });

      await tx.insert(schema.interiorUnitGroupFloorplans).values(
        g.floorPlanCodes.map((floorPlanCode) => ({
          propertyId: property.id,
          unitGroupId: row.id,
          floorPlanCode,
        })),
      );

      await tx.insert(schema.interiorBudgetPlan).values({
        propertyId: property.id,
        unitGroupId: row.id,
        budgetGroupId: tier.id,
        plannedUnits: plannedCounts[gi],
        note: MATCH_PRIOR_UNITS ? "Apportioned to the prior budget's unit count" : null,
      });
    }

    await tx
      .insert(schema.interiorBudgetSettings)
      .values({
        propertyId: property.id,
        cmSupervisionPct: cmPct.toFixed(3),
        contingencyPct: contPct.toFixed(3),
        cmCostCodeId: cmLine?.costCodeId ?? null,
        contingencyCostCodeId: contLine?.costCodeId ?? null,
      })
      .onConflictDoUpdate({
        target: schema.interiorBudgetSettings.propertyId,
        set: {
          cmSupervisionPct: cmPct.toFixed(3),
          contingencyPct: contPct.toFixed(3),
          cmCostCodeId: cmLine?.costCodeId ?? null,
          contingencyCostCodeId: contLine?.costCodeId ?? null,
          updatedAt: new Date(),
        },
      });
  });

  // --- 6. verify through the real compute path ----------------------------
  const actual = await computeInteriorBudgetFor(property.id);
  console.log(`\nWritten. Verifying through computeInteriorBudget():`);
  console.log(`  hasPlan                 : ${actual.hasPlan}`);
  console.log(`  unit groups × tiers     : ${actual.unitGroups.length} × ${actual.tiers.length}`);
  console.log(`  computed interior total : ${money(actual.total)}`);
  console.log(`  unmapped floorplans     : ${actual.unmappedFloorplans.length}`);
  for (const c of actual.columns) {
    const g = actual.unitGroups.find((x) => x.id === c.unitGroupId)!;
    console.log(
      `    ${g.name.padEnd(12)} ${String(g.unitCount).padStart(4)} units · avg ${String(g.avgSqft ?? "?").padStart(8)} SF · ${money(c.perUnitTotal)}/unit × ${c.plannedUnits} = ${money(c.totalCost)}`,
    );
  }

  const codeSum = roundMoney([...actual.byCostCode.values()].reduce((s, v) => s + v, 0));
  console.log(`  Σ per cost code         : ${money(codeSum)}`);

  if (roundMoney(actual.total - priorTotal) !== 0) {
    console.log(`\n✗ POST-WRITE MISMATCH: computed ${money(actual.total)} vs prior ${money(priorTotal)}`);
    process.exit(1);
  }
  if (codeSum !== actual.total) {
    console.log(`\n✗ RECONCILIATION BROKEN: per-cost-code Σ ${money(codeSum)} ≠ total ${money(actual.total)}`);
    process.exit(1);
  }
  console.log(`\n✓ Plan built and reconciles to the prior budget exactly.`);
  console.log(
    `  The ${priorLines.length} hand-entered interior lines are now superseded and shown locked.\n`,
  );
  await closeDb();
}

async function closeDb() {
  // The lazy client holds the pool open; nudge the process to exit cleanly.
  await new Promise((r) => setTimeout(r, 100));
  process.exit(0);
}

main().catch((e) => {
  console.error(`\n✗ ${e instanceof Error ? e.message : e}\n`);
  process.exit(1);
});

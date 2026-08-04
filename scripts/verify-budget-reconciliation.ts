/**
 * Live-database reconciliation check for every property's budget.
 *
 * Asserts the invariant the whole interior budget design rests on: for a property
 * with an interior plan, the pivot's column totals, its per-cost-code rollup, and
 * its reported total must all be the same number. If they diverge, the uplift
 * cost-code attribution is wrong and the Budget tab's Interiors division will
 * stop matching the Interior view.
 *
 * Also prints each property's effective budget — non-interior hand-entered lines
 * plus either the plan-derived interiors or the hand-entered ones — which is what
 * the portfolio home rolls up. Compare this before and after a backfill to prove
 * nothing double-counted.
 *
 * Run: npx tsx scripts/verify-budget-reconciliation.ts
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { eq, isNull, sql } from "drizzle-orm";
import { db } from "../src/db";
import * as schema from "../src/db/schema";
import { computeInteriorBudgets } from "../src/lib/interior-budget";
import { roundMoney } from "../src/lib/pricing";

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

async function main() {
  const d = db();
  const props = await d.select().from(schema.properties);
  const budgets = await computeInteriorBudgets(props.map((p) => p.id));

  const manual = await d
    .select({
      propertyId: schema.budgetLines.propertyId,
      isInterior: schema.costCodes.isInterior,
      total: sql<string>`coalesce(sum(${schema.budgetLines.uwAmount}), 0)`,
    })
    .from(schema.budgetLines)
    .innerJoin(schema.costCodes, eq(schema.budgetLines.costCodeId, schema.costCodes.id))
    .where(isNull(schema.budgetLines.archivedAt))
    .groupBy(schema.budgetLines.propertyId, schema.costCodes.isInterior);

  let fail = 0;
  for (const p of props) {
    const b = budgets.get(p.id)!;
    const mInt = Number(manual.find((m) => m.propertyId === p.id && m.isInterior)?.total ?? 0);
    const mOther = Number(manual.find((m) => m.propertyId === p.id && !m.isInterior)?.total ?? 0);
    const effective = roundMoney(mOther + (b.hasPlan ? b.total : mInt));

    console.log(`\n${p.name} (${p.slug})`);
    console.log(`  hasPlan               : ${b.hasPlan}`);
    console.log(`  manual non-interior   : ${money(mOther)}`);
    console.log(`  manual interior       : ${money(mInt)}${b.hasPlan ? "  (superseded)" : ""}`);
    if (b.hasPlan) {
      const codeSum = roundMoney([...b.byCostCode.values()].reduce((s, v) => s + v, 0));
      const colSum = roundMoney(b.columns.reduce((s, c) => s + c.totalCost, 0));
      console.log(`  plan: Σ column totals : ${money(colSum)}`);
      console.log(`  plan: Σ per cost code : ${money(codeSum)}`);
      console.log(`  plan: reported total  : ${money(b.total)}`);
      if (codeSum !== b.total || colSum !== b.total) {
        console.log(`  ✗ RECONCILIATION BROKEN`);
        fail++;
      } else {
        console.log(`  ✓ pivot reconciles (columns === cost codes === total)`);
      }
      if (roundMoney(b.total - mInt) !== 0) {
        console.log(`  ! plan differs from the superseded hand-entered interiors by ${money(roundMoney(b.total - mInt))}`);
      }
    }
    console.log(`  EFFECTIVE BUDGET      : ${money(effective)}`);
  }

  console.log(fail === 0 ? `\n✓ All properties reconcile.\n` : `\n✗ ${fail} broken.\n`);
  await new Promise((r) => setTimeout(r, 100));
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });

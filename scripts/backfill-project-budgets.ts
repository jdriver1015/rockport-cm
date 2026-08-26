/**
 * Recompute every project's budget_amount from its priced scope lines.
 *
 * projects.budget_amount used to be typed by hand while the scope lines carried
 * their own quantity x unit price, with nothing keeping the two in step. Every
 * unit turn in the portfolio held the same $12,906 tier default against real
 * scope sums between $11,247 and $16,992. The field is derived now — see
 * recomputeProjectBudget — so this brings the existing rows in line.
 *
 * Run once after deploying the derivation:
 *   npx tsx scripts/backfill-project-budgets.ts          # report only
 *   npx tsx scripts/backfill-project-budgets.ts --write  # apply
 *
 * Idempotent: re-running writes the same values.
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { eq, isNull } from "drizzle-orm";
import { db, schema } from "../src/db";
import { scopeLineTotal } from "../src/lib/scope-total";

const WRITE = process.argv.includes("--write");
const usd = (n: number) => Math.round(n).toLocaleString();

async function main() {
  const projects = await db()
    .select({
      id: schema.projects.id,
      name: schema.projects.name,
      budgetAmount: schema.projects.budgetAmount,
    })
    .from(schema.projects)
    .where(isNull(schema.projects.archivedAt));

  const lines = await db()
    .select({
      projectId: schema.scopeItems.projectId,
      quantity: schema.scopeItems.quantity,
      unitPrice: schema.scopeItems.unitPrice,
    })
    .from(schema.scopeItems)
    .where(isNull(schema.scopeItems.archivedAt));

  const byProject = new Map<number, { sum: number; unpriced: number }>();
  for (const l of lines) {
    const acc = byProject.get(l.projectId) ?? { sum: 0, unpriced: 0 };
    const total = scopeLineTotal(l);
    if (total == null) acc.unpriced++;
    else acc.sum += total;
    byProject.set(l.projectId, acc);
  }

  let changed = 0;
  for (const p of projects) {
    const acc = byProject.get(p.id) ?? { sum: 0, unpriced: 0 };
    const typed = Number(p.budgetAmount ?? 0);
    if (Math.abs(acc.sum - typed) < 0.01) continue;
    changed++;
    const note = acc.unpriced > 0 ? `  (${acc.unpriced} unpriced)` : "";
    console.log(
      `  ${`${p.name} #${p.id}`.slice(0, 34).padEnd(35)}${usd(typed).padStart(11)} -> ${usd(acc.sum).padStart(11)}${note}`,
    );
    if (WRITE) {
      await db()
        .update(schema.projects)
        .set({ budgetAmount: acc.sum.toFixed(2) })
        .where(eq(schema.projects.id, p.id));
    }
  }

  console.log(
    `\n  ${changed} of ${projects.length} project(s) ${WRITE ? "updated" : "would change"}.` +
      (WRITE ? "" : "  Re-run with --write to apply."),
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

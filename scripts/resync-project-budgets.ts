/**
 * Bring every project's stored budget back in line with its priced scope.
 *
 * projects.budget_amount is derived — recomputeProjectBudget owns it — but
 * updateProject used to overwrite it on every save of a common-area project.
 * The edit dialog has no budget input, so the value it wrote was always
 * "0.00": renaming a common project silently zeroed its budget until the next
 * scope edit put it back. This puts anything left stale back where it belongs.
 *
 *   npx tsx scripts/resync-project-budgets.ts           (dry run)
 *   npx tsx scripts/resync-project-budgets.ts --apply
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { asc, isNull } from "drizzle-orm";
import { db, schema } from "../src/db";
import { recomputeProjectBudget } from "../src/lib/project-budget-derive";
import { scopeLineTotal } from "../src/lib/scope-total";
import { and, eq } from "drizzle-orm";

const APPLY = process.argv.includes("--apply");

async function main() {
  const projects = await db()
    .select({
      id: schema.projects.id,
      name: schema.projects.name,
      kind: schema.projects.kind,
      budgetAmount: schema.projects.budgetAmount,
    })
    .from(schema.projects)
    .where(isNull(schema.projects.archivedAt))
    .orderBy(asc(schema.projects.id));

  let drifted = 0;
  for (const p of projects) {
    const lines = await db()
      .select({ quantity: schema.scopeItems.quantity, unitPrice: schema.scopeItems.unitPrice })
      .from(schema.scopeItems)
      .where(
        and(eq(schema.scopeItems.projectId, p.id), isNull(schema.scopeItems.archivedAt)),
      );
    const scope = lines.reduce((sum, l) => sum + (scopeLineTotal(l) ?? 0), 0);
    const stored = Number(p.budgetAmount ?? 0);
    if (Math.abs(stored - scope) < 0.005) continue;

    drifted++;
    console.log(
      `  #${String(p.id).padStart(3)} ${p.name.slice(0, 28).padEnd(28)} ${p.kind.padEnd(6)} ` +
        `stored ${stored.toFixed(2).padStart(12)} → scope ${scope.toFixed(2).padStart(12)}`,
    );
    if (APPLY) await recomputeProjectBudget(p.id);
  }

  console.log(
    `\n${projects.length} project(s) checked, ${drifted} out of step. ` +
      (APPLY ? "Applied." : drifted > 0 ? "Re-run with --apply to fix." : "Nothing to do."),
  );
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });

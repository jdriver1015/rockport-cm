/**
 * Backfill `gl_transactions.original_cost_code_id` for rows that were already
 * posted before the column was added (0028_gl_original_cost_code.sql).
 *
 * A posted row's originalCostCodeId is just its current cost_code_id — the
 * assumption "the row has only ever been posted once with this code" holds in
 * the pre-feature world because no column existed to record the earlier code.
 *
 * Run once after the migration:
 *   npx tsx scripts/backfill-original-cost-code.ts
 *
 * Idempotent: only writes rows where original_cost_code_id IS NULL, so a
 * partial backfill is safe to re-run.
 */
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db, schema } from "../src/db";
// Match other scripts/ files: tsx invokes them directly from the project root,
// so the @/ alias is unavailable — use a relative import.

async function main() {
  const updated = await db()
    .update(schema.glTransactions)
    .set({ originalCostCodeId: sql`cost_code_id` })
    .where(
      and(
        eq(schema.glTransactions.status, "posted"),
        isNotNull(schema.glTransactions.costCodeId),
        isNull(schema.glTransactions.originalCostCodeId),
      ),
    )
    .returning({ id: schema.glTransactions.id });

  console.log(`Backfilled original_cost_code_id on ${updated.length} posted transaction(s).`);
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});

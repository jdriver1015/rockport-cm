/**
 * Backfill projects.phase from projects.stage, and populate fromPhase/toPhase
 * on projectStageEvents. Idempotent — safe to run multiple times.
 *
 * Usage: npx tsx scripts/migrate-project-phases.ts
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
import { sql } from "drizzle-orm";
import { db } from "../src/db";

const STAGE_TO_PHASE: Record<string, string> = {
  planned: "precon",
  bidding: "precon",
  ready: "precon",
  in_progress: "in_process",
  punch: "punch",
  complete: "complete",
  invoiced: "complete",
  closed: "complete",
};

async function main() {
  const d = db();

  // 1. Backfill projects.phase from projects.stage
  for (const [stage, phase] of Object.entries(STAGE_TO_PHASE)) {
    await d.execute(
      sql`UPDATE projects SET phase = ${phase}::project_phase WHERE stage = ${stage}::project_stage AND phase != ${phase}::project_phase`,
    );
  }
  console.log("✓ Backfilled phase on projects");

  // 2. Backfill projectStageEvents.fromPhase/toPhase from fromStage/toStage
  for (const [stage, phase] of Object.entries(STAGE_TO_PHASE)) {
    await d.execute(
      sql`UPDATE project_stage_events SET to_phase = ${phase}::project_phase WHERE to_stage = ${stage}::project_stage AND (to_phase IS NULL OR to_phase != ${phase}::project_phase)`,
    );
    await d.execute(
      sql`UPDATE project_stage_events SET from_phase = ${phase}::project_phase WHERE from_stage = ${stage}::project_stage AND (from_phase IS NULL OR from_phase != ${phase}::project_phase)`,
    );
  }
  console.log("✓ Backfilled fromPhase/toPhase on stage events");

  // 3. Count no-op phase transitions (e.g. planned→bidding both mapped to precon)
  const [noopRow] = await d.execute(
    sql`SELECT count(*)::int as c FROM project_stage_events WHERE from_phase IS NOT NULL AND from_phase = to_phase`,
  ) as unknown as [{ c: number }];
  const noopCount = noopRow?.c ?? 0;
  if (noopCount > 0) {
    console.log(`  ${noopCount} stage events are no-op phase transitions (kept for stage history)`);
  }

  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

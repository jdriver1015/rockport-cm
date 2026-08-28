/**
 * READ-ONLY. What the schedule actually costs, from milestone_slip_events.
 *
 * This is the post-mortem side of automatic target slip. Targets move on their
 * own so the plan stays a forecast, and every move lands here — so the question
 * "which phase do we lose time in?" is a group-by rather than a memory test.
 *
 * All figures are WORKING days, which is how the slip is counted: a Friday miss
 * picked up on Monday cost one working day, not three.
 *
 *   npx tsx scripts/report-slippage.ts
 *
 * Changes nothing.
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { PROJECT_PHASES } from "../src/lib/stages";

type Row = Record<string, string | number | null>;

async function main() {
  const total = (await db().execute(sql`
    select count(*)::int n from milestone_slip_events`)) as unknown as Row[];
  if (Number(total[0].n) === 0) {
    console.log("\nNo slip recorded yet. Nothing has missed a target since this started tracking.\n");
    return;
  }

  console.log("\n── Slip by phase ─────────────────────────────────────────────");
  const byPhase = (await db().execute(sql`
    select phase,
           count(*)::int pushes,
           sum(days)::int total_days,
           round(avg(days)::numeric, 1) avg_days,
           max(days)::int worst
    from milestone_slip_events
    where reason = 'missed'
    group by phase`)) as unknown as Row[];

  const order = new Map<string, number>(PROJECT_PHASES.map((p, i) => [p.key as string, i]));
  byPhase.sort((a, b) => (order.get(String(a.phase)) ?? 9) - (order.get(String(b.phase)) ?? 9));
  console.log("phase                pushes   total   avg   worst");
  for (const r of byPhase) {
    const label = PROJECT_PHASES.find((p) => (p.key as string) === String(r.phase))?.label ?? String(r.phase);
    console.log(
      `${label.padEnd(20)} ${String(r.pushes).padStart(6)} ${String(r.total_days).padStart(7)} ` +
        `${String(r.avg_days).padStart(5)} ${String(r.worst).padStart(7)}`,
    );
  }

  console.log("\n── Worst projects ────────────────────────────────────────────");
  // The tail phase only: every push moves several rows at once, so summing all
  // of them multiplies one slip by however many phases followed it.
  const worst = (await db().execute(sql`
    select p.name, pr.name property, sum(e.days)::int slipped, count(*)::int pushes
    from milestone_slip_events e
    join projects p on p.id = e.project_id
    join properties pr on pr.id = p.property_id
    where e.reason = 'missed' and e.phase = 'complete'
    group by p.name, pr.name
    order by slipped desc
    limit 15`)) as unknown as Row[];
  if (worst.length === 0) console.log("  (none yet)");
  for (const r of worst) {
    console.log(
      `  ${String(r.name).slice(0, 32).padEnd(32)} ${String(r.property).slice(0, 20).padEnd(20)} ` +
        `+${r.slipped}d over ${r.pushes} push${Number(r.pushes) === 1 ? "" : "es"}`,
    );
  }

  console.log("\n── Corrections ───────────────────────────────────────────────");
  const rebased = (await db().execute(sql`
    select count(*)::int n, coalesce(sum(days), 0)::int days
    from milestone_slip_events where reason = 'rebased'`)) as unknown as Row[];
  console.log(
    `  ${rebased[0].n} re-base(s) from corrected actuals, net ${rebased[0].days} working days.`,
  );
  console.log("  A negative figure is slip handed back — targets pushed for a");
  console.log("  transition that had in fact happened on time.\n");
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });

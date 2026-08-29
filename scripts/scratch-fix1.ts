import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
import { eq } from "drizzle-orm";
import { db, schema } from "../src/db";
import { defaultMilestoneRows } from "../src/lib/milestones";
import { slipOverdueTargets, readSlipTotals, readScheduleHealth } from "../src/lib/target-slip";
import { loadFixtures } from "./probe-fixtures";

async function make(fx: {propertyId:number}, name: string, dates: Record<string,string|null>) {
  const [p] = await db().insert(schema.projects)
    .values({ propertyId: fx.propertyId, kind: "common", name, phase: "precon" })
    .returning({ id: schema.projects.id });
  await db().insert(schema.projectMilestones).values(
    defaultMilestoneRows(p.id).map((r) => ({ ...r, plannedDate: dates[r.phase] ?? null })),
  );
  return p.id;
}
async function main() {
  const fx = await loadFixtures();
  const ids: number[] = [];
  try {
    // A: the case that read 0 — Complete deliberately blank
    const a = await make(fx, "ZZ fix — blank finish", { precon: "2026-08-03", in_process: "2026-08-06" });
    ids.push(a);
    const ra = await db().transaction((tx) => slipOverdueTargets(tx, a, "precon", "2026-08-28"));

    // B: all four dated — must NOT multiply by the three phases that moved
    const b = await make(fx, "ZZ fix — full plan",
      { precon: "2026-08-03", in_process: "2026-08-06", punch: "2026-08-20", complete: "2026-08-26" });
    ids.push(b);
    const rb = await db().transaction((tx) => slipOverdueTargets(tx, b, "precon", "2026-08-28"));
    // second push the next week — totals must accumulate, not reset
    const rb2 = await db().transaction((tx) => slipOverdueTargets(tx, b, "precon", "2026-09-04"));

    const totals = await readSlipTotals(ids);
    const health = await readScheduleHealth(ids);
    const evA = await db().select().from(schema.milestoneSlipEvents).where(eq(schema.milestoneSlipEvents.projectId, a));
    const evB = await db().select().from(schema.milestoneSlipEvents).where(eq(schema.milestoneSlipEvents.projectId, b));

    console.log(`A blank finish : moved ${ra?.days}d, ${evA.length} event(s) -> total ${totals.get(a)}  (want ${ra?.days})`);
    console.log(`B full plan    : moved ${rb?.days}d then ${rb2?.days}d over ${evB.length} events -> total ${totals.get(b)}  (want ${(rb?.days??0)+(rb2?.days??0)}, NOT ${evB.reduce((n,e)=>n+e.days,0)})`);
    console.log(`A health: ${JSON.stringify(health.get(a))}`);
    console.log(`B health: ${JSON.stringify(health.get(b))}`);
  } finally {
    for (const id of ids) {
      await db().delete(schema.milestoneSlipEvents).where(eq(schema.milestoneSlipEvents.projectId, id));
      await db().delete(schema.projectMilestones).where(eq(schema.projectMilestones.projectId, id));
      await db().delete(schema.projects).where(eq(schema.projects.id, id));
    }
    console.log("cleaned up");
  }
}
main().then(()=>process.exit(0),(e)=>{console.error(e);process.exit(1);});

/**
 * Checks the executive capital views. Mostly pure fixtures; the last section
 * reads the tracker property read-only.
 *
 *   npx tsx scripts/probe-exec-capital.ts
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
import { eq } from "drizzle-orm";
import { db, schema } from "../src/db";
import { capitalByPhase, deploymentCurve, type ProjectRow } from "../src/lib/exec-capital";
import { readExecCapital } from "../src/lib/exec-capital-data";

let pass = 0;
let fail = 0;
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}${detail ? `  — ${detail}` : ""}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? `  — ${detail}` : ""}`); }
};
const near = (a: number, b: number, eps = 0.01) => Math.abs(a - b) < eps;

const proj = (o: Partial<ProjectRow> & { budget: number }): ProjectRow => ({
  id: o.id ?? 1, name: o.name ?? "p", kind: o.kind ?? "common", phase: o.phase ?? "in_process",
  budget: o.budget, category: o.category ?? null,
  preconDate: o.preconDate ?? null, inProcessDate: o.inProcessDate ?? null,
  completeDate: o.completeDate ?? null, startDate: o.startDate ?? null,
});

async function main() {
  console.log("\n-- capital by phase --");
  {
    const r = capitalByPhase([
      proj({ budget: 100, phase: "precon", category: "Exterior" }),
      proj({ budget: 300, phase: "in_process", category: "Exterior" }),
      proj({ budget: 200, phase: "in_process", category: "Landscaping" }),
      proj({ budget: 50, phase: "in_process", kind: "unit" }),
    ]);
    ok("total sums every project", near(r.total, 650), `${r.total}`);
    ok("categories ranked by size", r.categories[0] === "Exterior", r.categories.join(", "));
    ok("unit turns land under Interiors", r.categories.includes("Interiors"));
    const ip = r.stacks.find((s) => s.phase === "in_process")!;
    ok("in-process total correct", near(ip.total, 550), `${ip.total}`);
    ok("stack values align to categories", near(ip.values[r.categories.indexOf("Landscaping")], 200));
    const pc = r.stacks.find((s) => s.phase === "precon")!;
    ok("precon isolated from in-process", near(pc.total, 100), `${pc.total}`);
    ok("every phase present even when empty", r.stacks.length === 4);
    ok("empty phase totals zero", r.stacks.find((s) => s.phase === "complete")!.total === 0);
  }

  console.log("\n-- category folding past the palette run --");
  {
    const many = Array.from({ length: 10 }, (_, i) =>
      proj({ id: i, budget: (10 - i) * 100, category: `Cat${i}` }));
    const r = capitalByPhase(many);
    ok("never exceeds 7 series", r.categories.length <= 7, `${r.categories.length}`);
    ok("tail folded into Other", r.categories[r.categories.length - 1] === "Other");
    const ip = r.stacks.find((s) => s.phase === "in_process")!;
    ok("folding preserves the total", near(ip.values.reduce((a, b) => a + b, 0), r.total), `${r.total}`);
    ok("largest category kept first", r.categories[0] === "Cat0");
  }
  {
    const exactly7 = Array.from({ length: 7 }, (_, i) => proj({ id: i, budget: 100, category: `C${i}` }));
    const r = capitalByPhase(exactly7);
    ok("exactly 7 categories are all kept",
      r.categories.length === 7 && !r.categories.includes("Other"), r.categories.join(","));
  }

  console.log("\n-- deployment curve --");
  {
    // One project, Jan..Apr (4 months), $400 => $100/mo.
    const r = deploymentCurve(
      [proj({ budget: 400, preconDate: "2026-01-15", completeDate: "2026-04-20" })],
      2400, "2026-02-10", 24);
    ok("curve starts at the first project month", r.points[0].month === "2026-01", r.points[0].month);
    ok("scheduled accumulates evenly",
      near(r.points[0].scheduled, 100) && near(r.points[3].scheduled, 400),
      `${r.points[0].scheduled} .. ${r.points[3].scheduled}`);
    ok("scheduled plateaus after completion", near(r.points[5].scheduled, 400));
    ok("underwritten is linear",
      near(r.points[0].underwritten, 100) && near(r.points[11].underwritten, 1200));
    ok("underwritten reaches the budget at 24 months", near(r.points[23].underwritten, 2400));
    ok("underwritten never exceeds the budget", r.points.every((p) => p.underwritten <= 2400 + 1e-9));
    ok("runs the full 24 months even for a short programme", r.points.length === 24, `${r.points.length}`);
    ok("today marked in the right month", r.todayIndex === 1, `${r.todayIndex}`);
    ok("scheduled total reported", near(r.scheduledTotal, 400));
  }
  {
    const r = deploymentCurve(
      [proj({ budget: 100, preconDate: "2026-01-05", completeDate: "2028-06-05" })],
      100, "2026-01-05", 24);
    ok("axis extends to the last project month",
      r.points[r.points.length - 1].month === "2028-06", r.points[r.points.length - 1].month);
  }
  {
    const r = deploymentCurve(
      [proj({ budget: 100, preconDate: "2026-03-01", completeDate: "2026-03-31" })],
      100, "2026-03-01", 24);
    ok("single-month project books in one month", near(r.points[0].scheduled, 100));
  }
  {
    const r = deploymentCurve(
      [proj({ budget: 500 }), proj({ budget: 200, preconDate: "2026-01-01", completeDate: "2026-01-31" })],
      1000, "2026-01-15", 24);
    ok("undated projects reported, not silently dropped",
      r.undatedCount === 1 && near(r.undatedAmount, 500), `${r.undatedCount} / ${r.undatedAmount}`);
    ok("undated capital excluded from the curve", near(r.scheduledTotal, 200), `${r.scheduledTotal}`);
  }
  {
    const r = deploymentCurve([proj({ budget: 90, completeDate: "2026-05-10" })], 90, "2026-05-01", 24);
    ok("complete-date-only project still books", near(r.scheduledTotal, 90) && r.undatedCount === 0);
  }
  {
    const r = deploymentCurve(
      [proj({ budget: 60, preconDate: "2026-06-01", completeDate: "2026-04-01" })], 60, "2026-05-01", 24);
    ok("reversed dates are ordered, not dropped", near(r.scheduledTotal, 60), `${r.scheduledTotal}`);
  }
  {
    const r = deploymentCurve([], 1200, "2026-01-15", 24);
    ok("no projects still draws the underwritten line",
      r.points.length === 24 && near(r.points[23].underwritten, 1200));
    ok("no projects means a flat zero scheduled line", r.points.every((p) => p.scheduled === 0));
  }

  console.log("\n-- against the tracker property (read-only) --");
  {
    const p = await db().query.properties.findFirst({
      where: eq(schema.properties.slug, "aston-post-oak-tracker"),
    });
    if (!p) {
      console.log("  SKIP  tracker property not present");
    } else {
      const r = await readExecCapital(p.id, "2026-09-01");
      ok("budget total ties to the loaded budget", near(r.budgetTotal, 4_599_900),
        `$${r.budgetTotal.toLocaleString()}`);
      ok("phase stacks sum to the project total",
        near(r.byPhase.stacks.reduce((s, x) => s + x.total, 0), r.projectTotal),
        `$${r.projectTotal.toLocaleString()}`);
      ok("scheduled lands at or under the budget", r.curve.scheduledTotal <= r.budgetTotal + 1,
        `$${Math.round(r.curve.scheduledTotal).toLocaleString()} of $${r.budgetTotal.toLocaleString()}`);
      ok("curve carries a today marker", r.curve.todayIndex >= 0, `index ${r.curve.todayIndex}`);
      ok("categories within the palette run", r.byPhase.categories.length <= 7,
        r.byPhase.categories.join(", "));
      ok("in-process is the largest phase",
        r.inProcessTotal === Math.max(...r.byPhase.stacks.map((s) => s.total)),
        `$${r.inProcessTotal.toLocaleString()} across ${r.inProcessCount}`);
      console.log(`        curve spans ${r.curve.points[0].label} .. ${r.curve.points[r.curve.points.length - 1].label}`);
      console.log(`        unscheduled capital $${Math.round(r.budgetTotal - r.curve.scheduledTotal).toLocaleString()}`);
    }
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });

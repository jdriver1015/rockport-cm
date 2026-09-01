/**
 * Puts an estimated schedule on the Aston tracker property's projects.
 *
 * The workbook tracks status ("On Track", "Blocked") but its Construction
 * Schedule sheet has no usable dates — every start and end is 00:00:00 and
 * every duration is #DIV/0!. So these are ESTIMATES, generated from what the
 * sheet does say, and they are meant to be corrected in the app rather than
 * trusted:
 *
 *   - Where a weekly-update note names a real date, that wins. Two do: the
 *     roof "work starting July 20" and the garage "contract executed 7/22".
 *   - Phase lengths scale with the size of the scope, because a $886k roof
 *     replacement does not run on the same clock as a $10k equipment order.
 *   - Work already in process is back-dated so it is under way as of today;
 *     work not started is placed ahead of today. Otherwise the Gantt would
 *     show a dozen jobs all beginning on the same morning.
 *   - Starts are staggered by size so the board reads as a sequenced programme
 *     rather than a single bar.
 *
 * Only touches the tracker property. Re-runnable — it overwrites the planned
 * dates it manages and leaves actual dates alone.
 *
 *   npx tsx scripts/seed-aston-tracker-schedule.ts
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "../src/db";
import { addBusinessDays, nextWeekday, dateFromIso, toIsoDate } from "../src/lib/schedule-defaults";

const TRACKER_SLUG = "aston-post-oak-tracker";

/** Where the programme is being planned from. */
const TODAY = "2026-09-01";

/** Explicit dates the workbook's own notes give for when work begins. */
const KNOWN_IN_PROCESS_START: Record<string, string> = {
  Roof: "2026-07-20", // "Work starting July 20."
  Garage: "2026-07-22", // "Contract executed 7/22."
};

/** Phase lengths in business days, by how big the job is. */
function durations(budget: number) {
  if (budget >= 250_000) return { precon: 30, inProcess: 60, punch: 15 };
  if (budget >= 50_000) return { precon: 20, inProcess: 30, punch: 10 };
  return { precon: 15, inProcess: 15, punch: 5 };
}

const weekday = (iso: string) => toIsoDate(nextWeekday(dateFromIso(iso)));

async function main() {
  const property = await db().query.properties.findFirst({
    where: eq(schema.properties.slug, TRACKER_SLUG),
  });
  if (!property) throw new Error(`${TRACKER_SLUG} not found`);
  if (property.slug !== TRACKER_SLUG) throw new Error("guard failed");

  const projects = await db()
    .select({
      id: schema.projects.id,
      name: schema.projects.name,
      kind: schema.projects.kind,
      phase: schema.projects.phase,
      budgetAmount: schema.projects.budgetAmount,
      startDate: schema.projects.startDate,
    })
    .from(schema.projects)
    .where(and(eq(schema.projects.propertyId, property.id), isNull(schema.projects.archivedAt)));

  // Biggest first, so the largest jobs anchor the earliest starts and the
  // stagger reads as a sequenced programme.
  const common = projects
    .filter((p) => p.kind === "common")
    .sort((a, b) => Number(b.budgetAmount) - Number(a.budgetAmount));

  let inProcessRank = 0;
  let preconRank = 0;
  const planned: { name: string; dates: Record<string, string> }[] = [];

  for (const p of common) {
    const budget = Number(p.budgetAmount);
    const d = durations(budget);

    let inProcessStart: string;
    if (KNOWN_IN_PROCESS_START[p.name]) {
      inProcessStart = KNOWN_IN_PROCESS_START[p.name];
    } else if (p.phase === "in_process") {
      // Already under way, so the start must land strictly BEFORE today — a
      // job cannot be in process and not yet begun. Staggered by size across
      // roughly the last six weeks, and clamped so the tail of the list cannot
      // drift past today however many projects there are.
      const offset = Math.min(-5, -(30 - inProcessRank * 3));
      inProcessStart = addBusinessDays(TODAY, offset);
      inProcessRank++;
    } else {
      // Not started: mobilise after a precon run that begins shortly.
      inProcessStart = addBusinessDays(TODAY, d.precon + 5 + preconRank * 10);
      preconRank++;
    }

    const preconStart = addBusinessDays(inProcessStart, -d.precon);
    const punchStart = addBusinessDays(inProcessStart, d.inProcess);
    const completeStart = addBusinessDays(punchStart, d.punch);

    const dates: Record<string, string> = {
      precon: weekday(preconStart),
      in_process: weekday(inProcessStart),
      punch: weekday(punchStart),
      complete: weekday(completeStart),
    };

    for (const [phase, iso] of Object.entries(dates)) {
      await db()
        .update(schema.projectMilestones)
        .set({ plannedDate: iso })
        .where(
          and(
            eq(schema.projectMilestones.projectId, p.id),
            eq(schema.projectMilestones.phase, phase as "precon"),
            isNull(schema.projectMilestones.actualDate),
          ),
        );
    }
    // startDate records when work ACTUALLY began, so it is only stamped for
    // jobs already in process — a plan does not belong in it.
    if (p.phase === "in_process" || p.phase === "punch" || p.phase === "complete") {
      await db().update(schema.projects).set({ startDate: dates.in_process }).where(eq(schema.projects.id, p.id));
    }
    planned.push({ name: p.name, dates });
  }

  console.log(`seeded ${planned.length} common-area projects on ${property.name}\n`);
  console.log("PROJECT                        PRECON      IN PROCESS  PUNCH       COMPLETE");
  for (const p of planned) {
    console.log(
      `${p.name.slice(0, 28).padEnd(30)} ${p.dates.precon}  ${p.dates.in_process}  ${p.dates.punch}  ${p.dates.complete}`,
    );
  }

  const turns = projects.filter((p) => p.kind === "unit");
  console.log(`\n${turns.length} unit turn(s) already carry the workbook's own dates — left alone.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

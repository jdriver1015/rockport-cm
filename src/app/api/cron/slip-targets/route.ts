import { NextResponse } from "next/server";
import { and, isNull, ne } from "drizzle-orm";
import { db, schema } from "@/db";
import { slipOverdueTargets } from "@/lib/target-slip";
import { logFieldChanges } from "@/lib/actions/activity-log";
import { toIsoDate, todayInBusinessZone } from "@/lib/schedule-defaults";
import { fmtDate } from "@/lib/format";
import { phaseLabel } from "@/lib/stages";

export const dynamic = "force-dynamic";

/**
 * Nightly: push every overdue target forward so the plan stays a forecast.
 *
 * Runs here rather than on page render because a server component that writes
 * is a page whose output depends on who looked at it last — and because the
 * schedule should be right at 7am whether or not anybody has opened it.
 *
 * Guarded by CRON_SECRET, which Vercel sends as a bearer token. Unauthenticated
 * this endpoint would let anyone in the world reschedule the portfolio.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = toIsoDate(todayInBusinessZone());

  // A completed project has nothing ahead of it to push.
  const projects = await db()
    .select({ id: schema.projects.id, phase: schema.projects.phase })
    .from(schema.projects)
    .where(and(isNull(schema.projects.archivedAt), ne(schema.projects.phase, "complete")));

  const slipped: { projectId: number; days: number; phases: number }[] = [];

  for (const p of projects) {
    // One transaction per project: a portfolio-wide rollback because a single
    // project had inconsistent dates would leave every other schedule stale.
    const result = await db().transaction((tx) =>
      slipOverdueTargets(tx, p.id, p.phase, today),
    );
    if (!result) continue;

    await logFieldChanges({
      projectId: p.id,
      userId: null,
      changes: result.moved.map((m) => ({
        field: "milestone:plannedDate",
        fieldLabel: `${phaseLabel(m.phase)}: Target Start`,
        from: fmtDate(m.from),
        to: fmtDate(m.to),
      })),
      note: `Pushed ${result.days} working day${result.days === 1 ? "" : "s"} — the phase was not reached by its target`,
    });

    slipped.push({ projectId: p.id, days: result.days, phases: result.moved.length });
  }

  return NextResponse.json({
    today,
    checked: projects.length,
    slipped: slipped.length,
    detail: slipped,
  });
}

import { and, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { evaluateGates } from "@/lib/phase-gates";
import { readPreconGateState } from "@/lib/precon-gate-state";
import { phaseIndex, phaseLabel, type ProjectPhaseKey } from "@/lib/stages";

/**
 * Server-side enforcement of the phase gates.
 *
 * The checks live in phase-gates.ts and are now shown inline on the project's
 * phases section, but showing them is not enforcing them: the phase can be
 * changed from the header dropdown, and later from anywhere else that calls
 * setProjectPhase. Checking here covers every path with one call.
 *
 * Kept out of the actions file so the query bundle is testable on its own and
 * the action gains only the call.
 */

export type GateVerdict = { ok: true } | { ok: false; error: string };

/**
 * Whether the move is a forward one. Only forward moves are gated: correcting a
 * project back to an earlier phase has to stay possible, or a wrong click
 * becomes unfixable.
 */
function isForward(from: string, to: string): boolean {
  const f = phaseIndex(from);
  const t = phaseIndex(to);
  return f !== -1 && t !== -1 && t > f;
}

export async function checkPhaseAdvance(
  projectId: number,
  fromPhase: string,
  toPhase: string,
): Promise<GateVerdict> {
  if (!isForward(fromPhase, toPhase)) return { ok: true };

  const startMilestone = await db().query.projectMilestones.findFirst({
    where: and(
      eq(schema.projectMilestones.projectId, projectId),
      eq(schema.projectMilestones.phase, "in_process"),
      isNull(schema.projectMilestones.archivedAt),
    ),
    columns: { actualDate: true },
  });

  const [findings] = await db()
    .select({ open: sql<number>`count(*)::int` })
    .from(schema.auditFindings)
    .innerJoin(schema.siteAudits, eq(schema.auditFindings.auditId, schema.siteAudits.id))
    .where(
      and(
        eq(schema.siteAudits.projectId, projectId),
        eq(schema.auditFindings.status, "open"),
        isNull(schema.siteAudits.archivedAt),
        isNull(schema.auditFindings.archivedAt),
      ),
    );

  const [gl] = await db()
    .select({ total: sql<number>`coalesce(sum(${schema.glTransactions.amount}), 0)::float8` })
    .from(schema.glTransactions)
    .where(
      and(eq(schema.glTransactions.projectId, projectId), eq(schema.glTransactions.status, "posted")),
    );

  const precon = await readPreconGateState(projectId);

  const result = evaluateGates(fromPhase as ProjectPhaseKey, toPhase as ProjectPhaseKey, {
    ...precon,
    hasStartMilestoneActual: !!startMilestone?.actualDate,
    openFindingCount: findings?.open ?? 0,
    postedGlTotal: gl?.total ?? 0,
  });

  if (result.allMet) return { ok: true };

  // Names the outstanding checks with their detail, so the refusal says what to
  // go and do rather than only that it said no.
  const unmet = result.checks
    .filter((c) => !c.met)
    .map((c) => `${c.label} (${c.detail})`)
    .join(", ");
  return {
    ok: false,
    error: `Can't advance to ${phaseLabel(toPhase)} yet — ${unmet}.`,
  };
}

import { and, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { PreconGateState } from "@/lib/phase-gates";

/**
 * Read the pre-con gate state for one project.
 *
 * One reader for both callers — the phases section that displays the gates and
 * the server-side check that enforces them. If those computed it separately they
 * would eventually disagree, and the disagreement would look like the gate
 * refusing something the screen says is done.
 */
export async function readPreconGateState(projectId: number): Promise<PreconGateState> {
  const [project, preWalk, scope, bids] = await Promise.all([
    db().query.projects.findFirst({
      where: eq(schema.projects.id, projectId),
      columns: { preWalkDate: true },
    }),
    // The one pre-walk for this project. A partial unique index guarantees there
    // is at most one, so "the" pre-walk is unambiguous.
    db().query.siteAudits.findFirst({
      where: and(
        eq(schema.siteAudits.projectId, projectId),
        eq(schema.siteAudits.kind, "pre_walk"),
        isNull(schema.siteAudits.archivedAt),
      ),
      columns: { status: true },
    }),
    db()
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.scopeItems)
      .where(and(eq(schema.scopeItems.projectId, projectId), isNull(schema.scopeItems.archivedAt))),
    db()
      .select({
        approved: sql<number>`count(*) filter (where ${schema.bids.approved})::int`,
        outstanding: sql<number>`count(*) filter (where ${schema.bids.status} = 'sent')::int`,
      })
      .from(schema.bids)
      .where(and(eq(schema.bids.projectId, projectId), isNull(schema.bids.archivedAt))),
  ]);

  return {
    preWalkDate: project?.preWalkDate ?? null,
    preWalkAuditStatus: (preWalk?.status as "draft" | "complete" | undefined) ?? null,
    scopeLineCount: scope[0]?.n ?? 0,
    hasApprovedBid: (bids[0]?.approved ?? 0) > 0,
    bidsOutstanding: bids[0]?.outstanding ?? 0,
  };
}

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
export type PreconGateExtras = {
  preWalkTime: string | null;
  preWalkAuditId: number | null;
};

export async function readPreconGateState(
  projectId: number,
): Promise<PreconGateState & PreconGateExtras> {
  const [project, preWalk, scope, bids] = await Promise.all([
    db().query.projects.findFirst({
      where: eq(schema.projects.id, projectId),
      columns: { preWalkDate: true, preWalkTime: true, contractSignedAt: true },
    }),
    // The one pre-walk for this project. A partial unique index guarantees there
    // is at most one, so "the" pre-walk is unambiguous.
    db().query.siteAudits.findFirst({
      where: and(
        eq(schema.siteAudits.projectId, projectId),
        eq(schema.siteAudits.kind, "pre_walk"),
        isNull(schema.siteAudits.archivedAt),
      ),
      columns: { id: true, status: true },
    }),
    db()
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.scopeItems)
      .where(and(eq(schema.scopeItems.projectId, projectId), isNull(schema.scopeItems.archivedAt))),
    db()
      .select({
        approved: sql<number>`count(*) filter (where ${schema.bids.approved})::int`,
        outstanding: sql<number>`count(*) filter (where ${schema.bids.status} = 'sent')::int`,
        // An RFP went out. sent_at rather than status, because a vendor who has
        // since returned or declined still received the request — the RFP gate
        // records that the scope left the building, not where it ended up.
        sent: sql<number>`count(*) filter (where ${schema.bids.sentAt} is not null)::int`,
      })
      .from(schema.bids)
      .where(and(eq(schema.bids.projectId, projectId), isNull(schema.bids.archivedAt))),
  ]);

  return {
    preWalkDate: project?.preWalkDate ?? null,
    preWalkTime: project?.preWalkTime ?? null,
    preWalkAuditId: preWalk?.id ?? null,
    preWalkAuditStatus: (preWalk?.status as "draft" | "complete" | undefined) ?? null,
    scopeLineCount: scope[0]?.n ?? 0,
    bidsSent: bids[0]?.sent ?? 0,
    hasApprovedBid: (bids[0]?.approved ?? 0) > 0,
    bidsOutstanding: bids[0]?.outstanding ?? 0,
    contractSignedAt: project?.contractSignedAt ?? null,
  };
}

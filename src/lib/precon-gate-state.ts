import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
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
  const [project, preWalk, scope, bids, contract] = await Promise.all([
    db().query.projects.findFirst({
      where: eq(schema.projects.id, projectId),
      columns: {
        preWalkDate: true,
        preWalkTime: true,
        contractSignedAt: true,
        scopeConfirmedAt: true,
        budgetAmount: true,
      },
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
        // Sent and not taken back. A withdrawn request is one we pulled so the
        // scope could change, so it must not hold the gate open — otherwise
        // withdrawing re-opens the scope while still claiming the RFP is out.
        // Declined still counts: it did go out, the vendor just said no.
        sent: sql<number>`count(*) filter (
          where ${schema.bids.sentAt} is not null and ${schema.bids.status} <> 'withdrawn')::int`,
        // How long the slowest vendor has been sitting on a request. Whole days
        // from the send, so "out 6d" matches what a person would count.
        oldestSentDays: sql<number | null>`
          max(date_part('day', now() - ${schema.bids.sentAt}))
            filter (where ${schema.bids.status} = 'sent')::int`,
        direct: sql<number>`count(*) filter (where ${schema.bids.source} = 'direct' and ${schema.bids.approved})::int`,
      })
      .from(schema.bids)
      .where(and(eq(schema.bids.projectId, projectId), isNull(schema.bids.archivedAt))),
    // The live contract. Voided rows are history and must not hold the gate.
    db().query.projectContracts.findFirst({
      where: and(
        eq(schema.projectContracts.projectId, projectId),
        ne(schema.projectContracts.status, "voided"),
      ),
      orderBy: desc(schema.projectContracts.id),
      columns: { status: true, sentAt: true, createdAt: true },
    }),
  ]);

  return {
    preWalkDate: project?.preWalkDate ?? null,
    preWalkTime: project?.preWalkTime ?? null,
    preWalkAuditId: preWalk?.id ?? null,
    preWalkAuditStatus: (preWalk?.status as "draft" | "complete" | undefined) ?? null,
    scopeLineCount: scope[0]?.n ?? 0,
    bidsSent: bids[0]?.sent ?? 0,
    oldestSentDays: bids[0]?.oldestSentDays ?? null,
    directAward: (bids[0]?.direct ?? 0) > 0,
    // Days the contract has been with the other side. Only counts once it has
    // actually gone out — a generated draft sitting on our desk is our delay,
    // not theirs, and lumping the two together would hide which is which.
    contractStatus: contract?.status ?? null,
    contractOutDays:
      contract && (contract.status === "out_for_signature" || contract.status === "vendor_signed")
        ? Math.max(
            0,
            Math.floor((Date.now() - (contract.sentAt ?? contract.createdAt).getTime()) / 86_400_000),
          )
        : null,
    hasApprovedBid: (bids[0]?.approved ?? 0) > 0,
    bidsOutstanding: bids[0]?.outstanding ?? 0,
    contractSignedAt: project?.contractSignedAt ?? null,
    scopeConfirmedAt: project?.scopeConfirmedAt ?? null,
    approvedBudget: Number(project?.budgetAmount ?? 0),
  };
}

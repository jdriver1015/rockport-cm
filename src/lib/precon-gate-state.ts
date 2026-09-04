import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { coverageOf } from "@/lib/award-coverage";
import type { PreconGateState, ProgressGateState } from "@/lib/phase-gates";

/**
 * Read the gate state for a SET of projects, in a fixed number of queries.
 *
 * The per-project reader below used to be the only one, and the board's Next
 * Step column would have called it once per row: six queries each, plus two more
 * for award coverage, plus three for the progress gates. Thirteen common-area
 * projects is a hundred and forty round trips; a property mid-turn has a few
 * hundred unit projects and the page would simply never finish.
 *
 * So this is the real reader and the singular one is a wrapper. Nine queries
 * whatever the row count, and the coverage rule is still `coverageOf` from
 * award-coverage.ts rather than a second copy of it — the last time coverage was
 * reimplemented, a lump-sum bid read as covering nothing and the bid gate could
 * never be met.
 */
export type PreconGateExtras = {
  preWalkTime: string | null;
  preWalkAuditId: number | null;
};

export type FullGateState = PreconGateState & PreconGateExtras & ProgressGateState;

/** Least-advanced first, so a project with one signed contract and one still
 *  out reports the one still out. */
const CONTRACT_ORDER = ["draft", "out_for_signature", "vendor_signed", "executed"];

export async function readGateStates(
  projectIds: readonly number[],
): Promise<Map<number, FullGateState>> {
  const ids = [...new Set(projectIds)];
  if (ids.length === 0) return new Map();

  const [
    projects,
    preWalks,
    scopeLines,
    bidStats,
    contracts,
    awardLines,
    startMilestones,
    findings,
    gl,
  ] = await Promise.all([
    db()
      .select({
        id: schema.projects.id,
        preWalkDate: schema.projects.preWalkDate,
        preWalkTime: schema.projects.preWalkTime,
        contractSignedAt: schema.projects.contractSignedAt,
        scopeConfirmedAt: schema.projects.scopeConfirmedAt,
        budgetAmount: schema.projects.budgetAmount,
      })
      .from(schema.projects)
      .where(inArray(schema.projects.id, ids)),

    // At most one pre-walk per project — a partial unique index guarantees it,
    // so "the" pre-walk stays unambiguous even read in bulk.
    db()
      .select({
        projectId: schema.siteAudits.projectId,
        id: schema.siteAudits.id,
        status: schema.siteAudits.status,
      })
      .from(schema.siteAudits)
      .where(
        and(
          inArray(schema.siteAudits.projectId, ids),
          eq(schema.siteAudits.kind, "pre_walk"),
          isNull(schema.siteAudits.archivedAt),
        ),
      ),

    // The live scope lines themselves, not a count: the count IS their length,
    // and coverage needs the ids anyway. One query for both.
    db()
      .select({ projectId: schema.scopeItems.projectId, id: schema.scopeItems.id })
      .from(schema.scopeItems)
      .where(and(inArray(schema.scopeItems.projectId, ids), isNull(schema.scopeItems.archivedAt))),

    db()
      .select({
        projectId: schema.bids.projectId,
        approved: sql<number>`count(*) filter (where ${schema.bids.approved})::int`,
        outstanding: sql<number>`count(*) filter (where ${schema.bids.status} = 'sent')::int`,
        // Sent and not taken back. A withdrawn request is one we pulled so the
        // scope could change, so it must not hold the gate open. Declined still
        // counts: it did go out, the vendor just said no.
        sent: sql<number>`count(*) filter (
          where ${schema.bids.sentAt} is not null and ${schema.bids.status} <> 'withdrawn')::int`,
        oldestSentDays: sql<number | null>`
          max(date_part('day', now() - ${schema.bids.sentAt}))
            filter (where ${schema.bids.status} = 'sent')::int`,
        direct: sql<number>`count(*) filter (where ${schema.bids.source} = 'direct' and ${schema.bids.approved})::int`,
      })
      .from(schema.bids)
      .where(and(inArray(schema.bids.projectId, ids), isNull(schema.bids.archivedAt)))
      .groupBy(schema.bids.projectId),

    // Every live contract. Voided rows are history and must not hold the gate.
    db()
      .select({
        projectId: schema.projectContracts.projectId,
        status: schema.projectContracts.status,
        sentAt: schema.projectContracts.sentAt,
        createdAt: schema.projectContracts.createdAt,
      })
      .from(schema.projectContracts)
      .where(
        and(
          inArray(schema.projectContracts.projectId, ids),
          ne(schema.projectContracts.status, "voided"),
        ),
      ),

    // Approved bids joined to their lines. Grouped back per bid below, then run
    // through coverageOf — a lump-sum bid with no scope_item_id covers the whole
    // job, which a count(distinct) would read as covering nothing.
    db()
      .select({
        projectId: schema.bids.projectId,
        bidId: schema.bids.id,
        scopeItemId: schema.bidLineItems.scopeItemId,
      })
      .from(schema.bids)
      .leftJoin(schema.bidLineItems, eq(schema.bidLineItems.bidId, schema.bids.id))
      .where(
        and(
          inArray(schema.bids.projectId, ids),
          eq(schema.bids.approved, true),
          isNull(schema.bids.archivedAt),
        ),
      ),

    db()
      .select({
        projectId: schema.projectMilestones.projectId,
        actualDate: schema.projectMilestones.actualDate,
      })
      .from(schema.projectMilestones)
      .where(
        and(
          inArray(schema.projectMilestones.projectId, ids),
          eq(schema.projectMilestones.phase, "in_process"),
          isNull(schema.projectMilestones.archivedAt),
        ),
      ),

    db()
      .select({
        projectId: schema.siteAudits.projectId,
        open: sql<number>`count(*)::int`,
      })
      .from(schema.auditFindings)
      .innerJoin(schema.siteAudits, eq(schema.auditFindings.auditId, schema.siteAudits.id))
      .where(
        and(
          inArray(schema.siteAudits.projectId, ids),
          eq(schema.auditFindings.status, "open"),
          isNull(schema.siteAudits.archivedAt),
          isNull(schema.auditFindings.archivedAt),
        ),
      )
      .groupBy(schema.siteAudits.projectId),

    db()
      .select({
        projectId: schema.glTransactions.projectId,
        total: sql<number>`coalesce(sum(${schema.glTransactions.amount}), 0)::float8`,
      })
      .from(schema.glTransactions)
      .where(
        and(
          inArray(schema.glTransactions.projectId, ids),
          eq(schema.glTransactions.status, "posted"),
        ),
      )
      .groupBy(schema.glTransactions.projectId),
  ]);

  // --- index everything by project ------------------------------------------

  const preWalkBy = new Map(preWalks.map((r) => [r.projectId, r]));
  const bidsBy = new Map(bidStats.map((r) => [r.projectId, r]));
  const startBy = new Map(startMilestones.map((r) => [r.projectId, r.actualDate]));
  const findingsBy = new Map(findings.map((r) => [r.projectId, r.open]));
  const glBy = new Map(gl.map((r) => [r.projectId, r.total]));

  const scopeBy = new Map<number, number[]>();
  for (const row of scopeLines) {
    const list = scopeBy.get(row.projectId);
    if (list) list.push(row.id);
    else scopeBy.set(row.projectId, [row.id]);
  }

  const contractsBy = new Map<number, typeof contracts>();
  for (const row of contracts) {
    const list = contractsBy.get(row.projectId);
    if (list) list.push(row);
    else contractsBy.set(row.projectId, [row]);
  }

  // project -> bid -> the scope lines that bid priced (nulls included).
  const awardsBy = new Map<number, Map<number, (number | null)[]>>();
  for (const row of awardLines) {
    let byBid = awardsBy.get(row.projectId);
    if (!byBid) {
      byBid = new Map();
      awardsBy.set(row.projectId, byBid);
    }
    const list = byBid.get(row.bidId);
    if (list) list.push(row.scopeItemId);
    else byBid.set(row.bidId, [row.scopeItemId]);
  }

  // --- assemble --------------------------------------------------------------

  const out = new Map<number, FullGateState>();

  for (const project of projects) {
    const preWalk = preWalkBy.get(project.id);
    const live = scopeBy.get(project.id) ?? [];
    const bids = bidsBy.get(project.id);
    const liveContracts = [...(contractsBy.get(project.id) ?? [])].sort(
      (a, b) => CONTRACT_ORDER.indexOf(a.status) - CONTRACT_ORDER.indexOf(b.status),
    );
    const contract = liveContracts[0] ?? null;
    const awardCount = bids?.approved ?? 0;

    // Union of what every approved bid covers. A Set, because two bids on
    // disjoint halves of one line list must not double-count it.
    const covered = new Set<number>();
    for (const scopeItemIds of (awardsBy.get(project.id) ?? new Map()).values()) {
      for (const lineId of coverageOf(live, scopeItemIds)) covered.add(lineId);
    }

    out.set(project.id, {
      preWalkDate: project.preWalkDate ?? null,
      preWalkTime: project.preWalkTime ?? null,
      preWalkAuditId: preWalk?.id ?? null,
      preWalkAuditStatus: (preWalk?.status as "draft" | "complete" | undefined) ?? null,
      scopeLineCount: live.length,
      bidsSent: bids?.sent ?? 0,
      oldestSentDays: bids?.oldestSentDays ?? null,
      directAward: (bids?.direct ?? 0) > 0,
      contractStatus: contract?.status ?? null,
      // Days the contract has been with the other side. Only counts once it has
      // actually gone out — a generated draft sitting on our desk is our delay,
      // not theirs, and lumping the two together would hide which is which.
      contractOutDays:
        contract && (contract.status === "out_for_signature" || contract.status === "vendor_signed")
          ? Math.max(
              0,
              Math.floor(
                (Date.now() - (contract.sentAt ?? contract.createdAt).getTime()) / 86_400_000,
              ),
            )
          : null,
      hasApprovedBid: awardCount > 0,
      awardCount,
      scopeLinesAwarded: covered.size,
      contractsLive: liveContracts.length,
      contractsExecuted: liveContracts.filter((c) => c.status === "executed").length,
      bidsOutstanding: bids?.outstanding ?? 0,
      contractSignedAt: project.contractSignedAt ?? null,
      scopeConfirmedAt: project.scopeConfirmedAt ?? null,
      approvedBudget: Number(project.budgetAmount ?? 0),
      hasStartMilestoneActual: !!startBy.get(project.id),
      openFindingCount: findingsBy.get(project.id) ?? 0,
      postedGlTotal: glBy.get(project.id) ?? 0,
    });
  }

  return out;
}

/**
 * Read the pre-con gate state for one project.
 *
 * One reader for every caller — the phases section that displays the gates, the
 * server-side check that enforces them, and the board's Next Step column. If
 * those computed it separately they would eventually disagree, and the
 * disagreement would look like the gate refusing something the screen says is
 * done. A thin wrapper over the batch for exactly that reason.
 */
export async function readPreconGateState(
  projectId: number,
): Promise<PreconGateState & PreconGateExtras> {
  const states = await readGateStates([projectId]);
  return states.get(projectId) ?? EMPTY_STATE;
}

/**
 * What a project that does not exist reads as.
 *
 * Every gate unmet, which is the safe answer: the old per-project reader used
 * `findFirst` and quietly produced this same all-zero shape for a missing id,
 * and checkPhaseAdvance refusing to advance a project that isn't there is the
 * behaviour to keep.
 */
const EMPTY_STATE: FullGateState = {
  preWalkDate: null,
  preWalkTime: null,
  preWalkAuditId: null,
  preWalkAuditStatus: null,
  scopeLineCount: 0,
  scopeConfirmedAt: null,
  approvedBudget: 0,
  bidsSent: 0,
  oldestSentDays: null,
  directAward: false,
  contractOutDays: null,
  contractStatus: null,
  hasApprovedBid: false,
  awardCount: 0,
  scopeLinesAwarded: 0,
  contractsLive: 0,
  contractsExecuted: 0,
  bidsOutstanding: 0,
  contractSignedAt: null,
  hasStartMilestoneActual: false,
  openFindingCount: 0,
  postedGlTotal: 0,
};

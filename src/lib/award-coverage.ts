import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";

// ---------------------------------------------------------------------------
// Award coverage.
//
// A project can let its scope to more than one vendor — siding to one sub,
// roofing to another — so "the winning bid" was never the right shape. What
// matters is which scope lines each approved bid actually prices. That is
// coverage, and it is already recorded: bid_line_items.scope_item_id.
//
// Two bids may both be approved as long as their covered lines are disjoint.
// Overlap is the thing to refuse — it means two vendors are contracted for the
// same work, and no amount of totalling afterwards can say which one is real.
// ---------------------------------------------------------------------------

/**
 * db(), or an open transaction.
 *
 * The write helpers take either, so a caller that must not leave half a state
 * behind — awarding, which flips a bid and then moves vendors, committed cost
 * and the project vendor — can hand them all one transaction.
 */
export type Executor =
  | ReturnType<typeof db>
  | Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];

/** The approved bid holding a scope line, for naming the conflict back to the user. */
export type LineHolder = {
  bidId: number;
  bidNumber: number;
  vendorId: number | null;
  vendorName: string | null;
};

/** Every non-archived scope line on a project. */
async function allScopeLineIds(exec: Executor, projectId: number): Promise<number[]> {
  const rows = await exec
    .select({ id: schema.scopeItems.id })
    .from(schema.scopeItems)
    .where(and(eq(schema.scopeItems.projectId, projectId), isNull(schema.scopeItems.archivedAt)))
    .orderBy(asc(schema.scopeItems.sortOrder), asc(schema.scopeItems.id));
  return rows.map((r) => r.id);
}

/**
 * The coverage rule, with the queries lifted out so it can be tested.
 *
 * `liveLineIds` is the project's non-archived scope; `scopeItemIds` is what a
 * bid's lines point at, nulls and all.
 */
export function coverageOf(
  liveLineIds: readonly number[],
  scopeItemIds: readonly (number | null | undefined)[],
): number[] {
  const scoped = [...new Set(scopeItemIds.filter((v): v is number => v != null))];
  // No scoped rows at all: a price for the whole job, so it covers the whole
  // scope. Reading this as "covers nothing" is what made the bid gate
  // unmeetable for a bid quoted as a single lump sum.
  if (scoped.length === 0) return [...liveLineIds];

  // Archived lines are dropped. A bid that priced a line since deleted does not
  // still hold it, and counting it would let coverage exceed the live scope and
  // read as complete.
  const live = new Set(liveLineIds);
  return scoped.filter((id) => live.has(id));
}

/** The project's live scope, and which approved bid holds each line. */
export type Coverage = {
  /** Non-archived scope line ids, in table order. */
  live: number[];
  /** Scope line id -> the approved bid covering it. */
  coverage: Map<number, LineHolder>;
};

/**
 * Read the whole coverage picture in two queries.
 *
 * One pass over the approved bids joined to their lines, plus the live scope —
 * rather than a query per bid. `excludeBidId` leaves one bid out, so a bid can
 * be checked against everything *else* awarded without colliding with its own
 * existing award.
 */
export async function readCoverage(
  projectId: number,
  opts: { excludeBidId?: number; exec?: Executor } = {},
): Promise<Coverage> {
  const exec = opts.exec ?? db();

  // Sequential, not Promise.all: `exec` may be an open transaction, which holds
  // a single reserved connection, and firing two queries at it concurrently is
  // not worth the round trip saved.
  const rows = await exec
    .select({
      bidId: schema.bids.id,
      bidNumber: schema.bids.bidNumber,
      vendorId: schema.bids.vendorId,
      vendorName: schema.vendors.name,
      scopeItemId: schema.bidLineItems.scopeItemId,
    })
    .from(schema.bids)
    .leftJoin(schema.vendors, eq(schema.vendors.id, schema.bids.vendorId))
    .leftJoin(schema.bidLineItems, eq(schema.bidLineItems.bidId, schema.bids.id))
    .where(
      and(
        eq(schema.bids.projectId, projectId),
        eq(schema.bids.approved, true),
        isNull(schema.bids.archivedAt),
      ),
    )
    .orderBy(asc(schema.bids.id));
  const live = await allScopeLineIds(exec, projectId);

  // Group the flattened join back into one entry per bid.
  const byBid = new Map<number, { holder: LineHolder; scopeItemIds: (number | null)[] }>();
  for (const r of rows) {
    let entry = byBid.get(r.bidId);
    if (!entry) {
      entry = {
        holder: {
          bidId: r.bidId,
          bidNumber: r.bidNumber,
          vendorId: r.vendorId,
          vendorName: r.vendorName,
        },
        scopeItemIds: [],
      };
      byBid.set(r.bidId, entry);
    }
    entry.scopeItemIds.push(r.scopeItemId);
  }

  const coverage = new Map<number, LineHolder>();
  for (const [bidId, entry] of byBid) {
    if (opts.excludeBidId != null && bidId === opts.excludeBidId) continue;
    for (const lineId of coverageOf(live, entry.scopeItemIds)) {
      // Lowest bid id wins the key — the bids are ordered, so the holder
      // reported for an overlapping line is stable rather than arbitrary.
      // Overlap cannot happen through the guarded paths; if legacy data has it,
      // reporting one holder beats reporting none.
      if (!coverage.has(lineId)) coverage.set(lineId, entry.holder);
    }
  }

  return { live, coverage };
}

/** Just the map, for callers that do not need the live scope alongside it. */
export async function readAwardCoverage(
  projectId: number,
  opts: { excludeBidId?: number; exec?: Executor } = {},
): Promise<Map<number, LineHolder>> {
  return (await readCoverage(projectId, opts)).coverage;
}

/**
 * The scope lines one bid prices.
 *
 * A bid whose lines are all manual — mobilization, labor, no scope_item_id —
 * covers the whole scope rather than nothing. An unscoped bid is a price for the
 * whole job, which is how the single-winner model always read it.
 */
export async function bidCoveredLineIds(
  projectId: number,
  bidId: number,
  exec: Executor = db(),
): Promise<number[]> {
  const rows = await exec
    .selectDistinct({ scopeItemId: schema.bidLineItems.scopeItemId })
    .from(schema.bidLineItems)
    .where(eq(schema.bidLineItems.bidId, bidId));
  const live = await allScopeLineIds(exec, projectId);
  return coverageOf(
    live,
    rows.map((r) => r.scopeItemId),
  );
}

/**
 * What a prospective set of bid lines would cover.
 *
 * Same rule, against lines that have not been written yet — so an edit to an
 * awarded bid can be checked for overlap before it is saved.
 */
export async function coveredLineIdsFor(
  projectId: number,
  scopeItemIds: readonly (number | null | undefined)[],
  exec: Executor = db(),
): Promise<number[]> {
  return coverageOf(await allScopeLineIds(exec, projectId), scopeItemIds);
}

/**
 * The approved bids whose lines collide with `lineIds`.
 *
 * In the order their lines are first encountered in `lineIds` — not by award
 * age. A caller needing one specific holder should pick it by bidId.
 */
export function overlappingHolders(
  coverage: Map<number, LineHolder>,
  lineIds: readonly number[],
): LineHolder[] {
  const byBid = new Map<number, LineHolder>();
  for (const id of lineIds) {
    const holder = coverage.get(id);
    if (holder) byBid.set(holder.bidId, holder);
  }
  return [...byBid.values()];
}

/** How a refused award reads back to the person who tried it. */
export function overlapMessage(holders: readonly LineHolder[], overlapCount: number): string {
  const who = holders.map((h) => h.vendorName ?? `bid #${h.bidNumber}`).join(" and ");
  return `${overlapCount} scope line${overlapCount === 1 ? " is" : "s are"} already awarded to ${who}. Award the rest, or replace that award.`;
}

/**
 * projects.committed_cost = every approved bid's lines, summed.
 *
 * It used to be the single winner's total, set at the moment of awarding. With
 * several awards live the number is only correct as a recomputation, so it is
 * one query rather than arithmetic at each call site — and it self-heals if an
 * award, an un-award and a bid edit ever land out of order.
 */
export async function recomputeCommittedCost(
  projectId: number,
  exec: Executor = db(),
): Promise<number> {
  const [row] = await exec
    .select({ total: sql<string>`coalesce(sum(${schema.bidLineItems.amount}), 0)` })
    .from(schema.bidLineItems)
    .innerJoin(schema.bids, eq(schema.bids.id, schema.bidLineItems.bidId))
    .where(
      and(
        eq(schema.bids.projectId, projectId),
        eq(schema.bids.approved, true),
        isNull(schema.bids.archivedAt),
      ),
    );

  const total = parseFloat(row?.total ?? "0");
  await exec
    .update(schema.projects)
    .set({ committedCost: total.toFixed(2) })
    .where(eq(schema.projects.id, projectId));
  return total;
}

/**
 * The project's vendor, when the awards agree on one.
 *
 * projects.vendor_id predates split awards and cannot hold two answers. With a
 * single awarded vendor it still means what it always did; with several there is
 * no such thing as *the* project's vendor, so whatever was set by hand — the GC
 * on an interior turn, say — is left alone rather than being overwritten by
 * whichever bid happened to be awarded last.
 *
 * `releasing` is the vendor of an award just taken back. With nothing awarded
 * any more, a project vendor still naming that vendor came FROM the award, so it
 * goes with it; a different value was set by hand and is left alone. Without
 * this, un-awarding left the project reporting a vendor that held nothing.
 */
export async function syncProjectVendor(
  projectId: number,
  opts: { releasing?: number | null; exec?: Executor } = {},
): Promise<void> {
  const exec = opts.exec ?? db();

  const rows = await exec
    .selectDistinct({ vendorId: schema.bids.vendorId })
    .from(schema.bids)
    .where(
      and(
        eq(schema.bids.projectId, projectId),
        eq(schema.bids.approved, true),
        isNull(schema.bids.archivedAt),
      ),
    );

  const vendorIds = rows.map((r) => r.vendorId).filter((v): v is number => v != null);

  if (vendorIds.length === 1) {
    await exec
      .update(schema.projects)
      .set({ vendorId: vendorIds[0] })
      .where(eq(schema.projects.id, projectId));
    return;
  }

  if (vendorIds.length === 0 && opts.releasing != null) {
    await exec
      .update(schema.projects)
      .set({ vendorId: null })
      .where(and(eq(schema.projects.id, projectId), eq(schema.projects.vendorId, opts.releasing)));
  }
}

/**
 * Stamp a bid's vendor onto the scope lines it won.
 *
 * scope_items.vendor_id used to be typed in by hand on each line, which meant it
 * recorded an intention rather than a fact — a line could name a vendor nobody
 * bid, nobody was awarded and no contract covered, and the scope table reported
 * it as settled. Awarding is the only thing that knows who is doing a line, so
 * awarding is what writes it.
 */
export async function applyAwardVendor(
  projectId: number,
  bidId: number,
  exec: Executor = db(),
): Promise<void> {
  const rows = await exec
    .select({ vendorId: schema.bids.vendorId })
    .from(schema.bids)
    .where(eq(schema.bids.id, bidId))
    .limit(1);

  const vendorId = rows[0]?.vendorId;
  if (vendorId == null) return;

  await setVendorOnLines(projectId, await bidCoveredLineIds(projectId, bidId, exec), vendorId, exec);
}

/**
 * Take the vendor back off the lines a bid no longer holds.
 *
 * Scoped to that bid's own lines rather than clearing everything uncovered:
 * lines carrying a vendor typed in before awards wrote this field are somebody's
 * real decision, and a rule about award coverage is no reason to delete them
 * silently. They surface as a mismatch to look at, not as a silent wipe.
 */
export async function clearAwardVendor(
  projectId: number,
  bidId: number,
  exec: Executor = db(),
): Promise<void> {
  await clearVendorOnLines(projectId, await bidCoveredLineIds(projectId, bidId, exec), exec);
}

/** Drop the vendor from named lines. Callers that know the old coverage pass it. */
export async function clearVendorOnLines(
  projectId: number,
  lineIds: readonly number[],
  exec: Executor = db(),
): Promise<void> {
  await setVendorOnLines(projectId, lineIds, null, exec);
}

async function setVendorOnLines(
  projectId: number,
  lineIds: readonly number[],
  vendorId: number | null,
  exec: Executor,
): Promise<void> {
  if (lineIds.length === 0) return;
  await exec
    .update(schema.scopeItems)
    .set({ vendorId })
    .where(
      and(eq(schema.scopeItems.projectId, projectId), inArray(schema.scopeItems.id, [...lineIds])),
    );
}

/**
 * Restamp every covered line from the awards that currently hold it.
 *
 * Derives the whole picture rather than one bid's part, so a caller that has
 * just cleared a stale set cannot leave a line another award still holds
 * without a vendor.
 */
export async function applyCoverageVendors(
  projectId: number,
  exec: Executor = db(),
): Promise<void> {
  const coverage = await readAwardCoverage(projectId, { exec });

  const byVendor = new Map<number, number[]>();
  for (const [lineId, holder] of coverage) {
    if (holder.vendorId == null) continue;
    const lines = byVendor.get(holder.vendorId) ?? [];
    lines.push(lineId);
    byVendor.set(holder.vendorId, lines);
  }

  for (const [vendorId, lineIds] of byVendor) {
    await setVendorOnLines(projectId, lineIds, vendorId, exec);
  }
}

/** Scope lines with no approved bid against them. */
export async function uncoveredLineIds(projectId: number): Promise<number[]> {
  const { live, coverage } = await readCoverage(projectId);
  return live.filter((id) => !coverage.has(id));
}

/** Narrow a caller's requested lines to ones that really are on this project. */
export async function ownedScopeLineIds(
  projectId: number,
  requested: readonly number[],
): Promise<number[]> {
  if (requested.length === 0) return [];
  const rows = await db()
    .select({ id: schema.scopeItems.id })
    .from(schema.scopeItems)
    .where(
      and(
        eq(schema.scopeItems.projectId, projectId),
        isNull(schema.scopeItems.archivedAt),
        inArray(schema.scopeItems.id, [...requested]),
      ),
    );
  return rows.map((r) => r.id);
}

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { scopeReadiness } from "@/lib/scope-readiness";
import {
  applyAwardVendor,
  overlapMessage,
  overlappingHolders,
  ownedScopeLineIds,
  readAwardCoverage,
  recomputeCommittedCost,
  syncProjectVendor,
  uncoveredLineIds,
  type Executor,
} from "@/lib/award-coverage";

// ---------------------------------------------------------------------------
// Confirming the scope, and taking it back.
//
// Plain functions rather than the actions, so they can be exercised without a
// request — revalidatePath throws outside one.
// ---------------------------------------------------------------------------

export type ConfirmResult = { ok: true } | { ok: false; error: string };

/**
 * Confirm the scope as ready to price.
 *
 * The preconditions are the point. Confirming is what unlocks sending the scope
 * to vendors, and a vendor cannot price a line with no description or quote
 * against a job with no approved budget — so the gate is called "Confirm Scope
 * & Budget" and now actually checks both. It used to accept any project with at
 * least one line, which let an unnamed, undescribed, unbudgeted draft go out.
 */
export async function confirmScopeRows(projectId: number): Promise<ConfirmResult> {
  const blocker = await scopeConfirmBlocker(projectId);
  if (blocker) return { ok: false, error: blocker };

  await db()
    .update(schema.projects)
    .set({ scopeConfirmedAt: new Date() })
    .where(eq(schema.projects.id, projectId));
  return { ok: true };
}

/**
 * The scope could not be confirmed as part of a larger write. Thrown inside the
 * caller's transaction so the whole write rolls back; the caller catches it and
 * returns the message as an ordinary refusal.
 */
export class ScopeNotReadyError extends Error {}

/**
 * Confirm the scope as part of a larger write — sending it out, or awarding it.
 *
 * Confirming used to be its own step in front of both, and it only ever meant
 * "these are the lines to price", which is exactly what sending them or
 * awarding them says. So those writes confirm it themselves now, checking the
 * same rules confirmScopeRows applies — a scope that could not be confirmed by
 * hand cannot slip through this way.
 *
 * The check and the stamp both run on the caller's transaction, and the project
 * row is locked first so two writers cannot both pass the check against lines
 * the other is changing. An unready scope throws ScopeNotReadyError, which rolls
 * back everything the caller did in the same transaction. An already-confirmed
 * scope is left alone and keeps its date.
 */
export async function confirmScopeInTx(tx: Executor, projectId: number): Promise<void> {
  const [project] = await tx
    .select({ scopeConfirmedAt: schema.projects.scopeConfirmedAt })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .for("update");
  if (!project) throw new ScopeNotReadyError("Project not found");
  if (project.scopeConfirmedAt) return;

  const blocker = await scopeConfirmBlocker(projectId, tx);
  if (blocker) throw new ScopeNotReadyError(blocker);

  await tx
    .update(schema.projects)
    .set({ scopeConfirmedAt: new Date() })
    .where(eq(schema.projects.id, projectId));
}

/** Why this scope cannot be confirmed yet, or null when it can. */
export async function scopeConfirmBlocker(
  projectId: number,
  exec: Executor = db(),
): Promise<string | null> {
  const project = await exec.query.projects.findFirst({
    where: eq(schema.projects.id, projectId),
    columns: { kind: true },
  });
  if (!project) return "Project not found";

  const lines = await exec
    .select({
      item: schema.scopeItems.item,
      description: schema.scopeItems.materialQuality,
      quantity: schema.scopeItems.quantity,
      unitPrice: schema.scopeItems.unitPrice,
    })
    .from(schema.scopeItems)
    .where(and(eq(schema.scopeItems.projectId, projectId), isNull(schema.scopeItems.archivedAt)));

  // Descriptions are required on common-area work only — see scopeReadiness.
  return scopeReadiness(lines, project.kind !== "unit").blocker;
}

/**
 * Un-confirm, when nothing has gone out and nothing is awarded.
 *
 * Refused once an RFP is live: the way back from there is withdrawing the
 * requests, which un-confirms as part of the same act. Two routes to the same
 * state, one of which skips telling the vendors, is how the scope and the
 * quotes come apart.
 *
 * Refused while any award stands, too. Awarding confirms the scope, and the
 * award's committed cost is measured against these lines — re-opening them
 * underneath it would let them change while the award still points at the old
 * ones. The award has to be taken back first.
 */
export async function unconfirmScopeRows(projectId: number): Promise<ConfirmResult> {
  const { liveRfpCount } = await import("@/lib/scope-lock");
  const live = await liveRfpCount(projectId);
  if (live > 0) {
    return {
      ok: false,
      error: `${live} vendor${live === 1 ? " is" : "s are"} pricing this scope. Withdraw the requests instead.`,
    };
  }
  const award = await db().query.bids.findFirst({
    where: and(
      eq(schema.bids.projectId, projectId),
      eq(schema.bids.approved, true),
      isNull(schema.bids.archivedAt),
    ),
    columns: { id: true },
  });
  if (award) {
    return { ok: false, error: "This scope is awarded. Take the award back before re-opening it." };
  }
  await db()
    .update(schema.projects)
    .set({ scopeConfirmedAt: null })
    .where(eq(schema.projects.id, projectId));
  return { ok: true };
}

export type WithdrawResult =
  | { ok: true; withdrawn: number; tokensRevoked: number }
  | { ok: false; error: string };

/**
 * Withdraw the outstanding requests and re-open the scope.
 *
 * One transaction doing three things, because any two of them without the third
 * leaves a lie behind: the bids stop being live, their portal links stop
 * working, and the scope goes back to unconfirmed.
 *
 * Revoking the tokens is the part that is easy to forget and matters most — a
 * contractor with the page still open in a truck would otherwise go on pricing
 * a scope that no longer exists, and submit it.
 */
export async function withdrawRfpsRows(projectId: number): Promise<WithdrawResult> {
  const live = await db()
    .select({ id: schema.bids.id })
    .from(schema.bids)
    .where(
      and(
        eq(schema.bids.projectId, projectId),
        isNull(schema.bids.archivedAt),
        eq(schema.bids.source, "rfp"),
        sql`${schema.bids.status} in ('sent', 'received')`,
      ),
    );
  if (live.length === 0) return { ok: false, error: "Nothing is out for bid" };

  const awarded = await db().query.bids.findFirst({
    where: and(
      eq(schema.bids.projectId, projectId),
      eq(schema.bids.approved, true),
      isNull(schema.bids.archivedAt),
    ),
    columns: { id: true },
  });
  if (awarded) {
    return {
      ok: false,
      error: "A bid has already been selected. Un-select it before withdrawing the requests.",
    };
  }

  const ids = live.map((b) => b.id);
  let tokensRevoked = 0;

  await db().transaction(async (tx) => {
    await tx
      .update(schema.bids)
      .set({ status: "withdrawn" })
      .where(inArray(schema.bids.id, ids));

    const revoked = await tx
      .update(schema.bidAccessTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          inArray(schema.bidAccessTokens.bidId, ids),
          isNull(schema.bidAccessTokens.revokedAt),
        ),
      )
      .returning({ id: schema.bidAccessTokens.id });
    tokensRevoked = revoked.length;

    await tx
      .update(schema.projects)
      .set({ scopeConfirmedAt: null })
      .where(eq(schema.projects.id, projectId));
  });

  return { ok: true, withdrawn: ids.length, tokensRevoked };
}

export type DirectAwardResult = { ok: true; bidId: number } | { ok: false; error: string };

/**
 * Let the work without competition.
 *
 * Writes a bid row like any other so everything downstream — the award, the
 * committed cost, the contract — reads off one shape. The reason is required:
 * the point of having this path at all is that it makes uncompeted spend
 * answerable rather than driving people to send sham requests to one vendor.
 */
export async function directAwardRows(
  projectId: number,
  vendorId: number,
  amount: string,
  reason: string,
  /**
   * The lines this award covers. Omitted means everything not already awarded,
   * which is the whole scope on a project with no awards yet — what this always
   * did — and the remainder once part of the job is let.
   */
  scopeItemIds?: readonly number[],
  /**
   * What each covered line costs, when that is actually known — a standing
   * rate agreement prices every line. Without it the whole amount lands on the
   * first line (see below), because a hand-typed direct award is one number.
   */
  lineAmounts?: ReadonlyMap<number, number>,
): Promise<DirectAwardResult> {
  if (!reason.trim()) return { ok: false, error: "Say why this is not going out for bid" };
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) return { ok: false, error: "Enter an amount" };

  const vendor = await db().query.vendors.findFirst({
    where: and(eq(schema.vendors.id, vendorId), eq(schema.vendors.active, true)),
    columns: { id: true },
  });
  if (!vendor) return { ok: false, error: "That vendor is not active" };

  // Not "does this project already have an award" any more — several vendors
  // may hold different parts of the scope. What cannot happen is two of them
  // holding the same line.
  const targetIds =
    scopeItemIds === undefined
      ? await uncoveredLineIds(projectId)
      : await ownedScopeLineIds(projectId, scopeItemIds);
  if (targetIds.length === 0) {
    if (scopeItemIds !== undefined) {
      return { ok: false, error: "Those scope items aren't on this project" };
    }
    // Nothing left to award means one of two different things, and "already
    // awarded" is a lie on a project that has no scope at all.
    const [{ n }] = await db()
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.scopeItems)
      .where(and(eq(schema.scopeItems.projectId, projectId), isNull(schema.scopeItems.archivedAt)));
    return {
      ok: false,
      error: n === 0 ? "There is no scope to award" : "Every scope line is already awarded",
    };
  }

  const coverage = await readAwardCoverage(projectId);
  const holders = overlappingHolders(coverage, targetIds);
  if (holders.length > 0) {
    const clashes = targetIds.filter((id) => coverage.has(id)).length;
    return { ok: false, error: overlapMessage(holders, clashes) };
  }

  const [{ maxNumber }] = await db()
    .select({ maxNumber: sql<number>`coalesce(max(${schema.bids.bidNumber}), 0)::int` })
    .from(schema.bids)
    .where(eq(schema.bids.projectId, projectId));

  // Only the lines being awarded. Seeding a line for the whole scope would have
  // this bid cover work it is not paying for, and coverage is what decides who
  // else may be awarded.
  const items = await db()
    .select({ id: schema.scopeItems.id, item: schema.scopeItems.item })
    .from(schema.scopeItems)
    .where(
      and(
        eq(schema.scopeItems.projectId, projectId),
        isNull(schema.scopeItems.archivedAt),
        inArray(schema.scopeItems.id, targetIds),
      ),
    )
    .orderBy(asc(schema.scopeItems.sortOrder), asc(schema.scopeItems.id));
  if (items.length === 0) return { ok: false, error: "There is no scope to award" };

  let bidId = 0;
  try {
    await db().transaction(async (tx) => {
    // Awarding confirms the scope, the same way sending it out does — but only
    // a scope that could be confirmed, or work would be committed against
    // unpriced lines with no budget to measure the award against.
    await confirmScopeInTx(tx, projectId);
    const [bid] = await tx
      .insert(schema.bids)
      .values({
        projectId,
        vendorId,
        bidNumber: maxNumber + 1,
        status: "received",
        source: "direct",
        awardReason: reason.trim(),
        approved: true,
        receivedDate: new Date().toISOString().slice(0, 10),
      })
      .returning({ id: schema.bids.id });
    bidId = bid.id;

    // A typed direct award is one agreed number, so it lands on the first line
    // rather than being split evenly — inventing a per-line breakdown nobody
    // quoted would look like data. Where the breakdown is real (an agreement's
    // rates), each line carries its own price, so the bid compares line by
    // line like any other.
    await tx.insert(schema.bidLineItems).values(
      items.map((it, n) => ({
        bidId: bid.id,
        scopeItemId: it.id,
        description: it.item,
        amount: lineAmounts
          ? (lineAmounts.get(it.id) ?? 0).toFixed(2)
          : n === 0
            ? value.toFixed(2)
            : "0.00",
        sortOrder: n,
      })),
    );
    });
  } catch (err) {
    if (err instanceof ScopeNotReadyError) return { ok: false, error: err.message };
    throw err;
  }

  // What setBidWinner does when a bid is awarded the normal way. Leaving it out
  // made a directly-awarded project read as $0 committed with no vendor — on
  // its own header, and in every portfolio rollup of committed cost. Recomputed
  // rather than assigned, because this award may be one of several.
  await applyAwardVendor(projectId, bidId);
  await recomputeCommittedCost(projectId);
  await syncProjectVendor(projectId);

  return { ok: true, bidId };
}

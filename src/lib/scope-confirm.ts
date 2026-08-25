import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import {
  applyAwardVendor,
  overlapMessage,
  overlappingHolders,
  ownedScopeLineIds,
  readAwardCoverage,
  recomputeCommittedCost,
  syncProjectVendor,
  uncoveredLineIds,
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
  const project = await db().query.projects.findFirst({
    where: eq(schema.projects.id, projectId),
    columns: { budgetAmount: true, kind: true },
  });
  if (!project) return { ok: false, error: "Project not found" };

  if (Number(project.budgetAmount ?? 0) <= 0) {
    return { ok: false, error: "Approve a budget before confirming the scope" };
  }

  const lines = await db()
    .select({
      id: schema.scopeItems.id,
      item: schema.scopeItems.item,
      description: schema.scopeItems.materialQuality,
    })
    .from(schema.scopeItems)
    .where(and(eq(schema.scopeItems.projectId, projectId), isNull(schema.scopeItems.archivedAt)));

  if (lines.length === 0) return { ok: false, error: "There is no scope to confirm" };

  // Named individually rather than counted: "3 lines need a description" sends
  // you hunting, and the whole reason to confirm is that somebody read them.
  const unnamed = lines.filter((l) => !l.item?.trim());
  if (unnamed.length > 0) {
    return { ok: false, error: `${describeLines(unnamed.length)} still need a name` };
  }

  // Descriptions are required on common-area work, which goes out to vendors who
  // price from a written scope. A unit turn's lines are generated from a budget
  // group — the template item IS the specification, and there is no bid package
  // to describe — so requiring prose there would block every turn in the
  // portfolio on data the generator was never asked to write.
  const undescribed =
    project.kind === "unit" ? [] : lines.filter((l) => !l.description?.trim());
  if (undescribed.length > 0) {
    const names = undescribed.map((l) => l.item.trim()).slice(0, 3).join(", ");
    const more = undescribed.length > 3 ? ` and ${undescribed.length - 3} more` : "";
    return {
      ok: false,
      error: `${describeLines(undescribed.length)} still need a description: ${names}${more}`,
    };
  }

  await db()
    .update(schema.projects)
    .set({ scopeConfirmedAt: new Date() })
    .where(eq(schema.projects.id, projectId));
  return { ok: true };
}

function describeLines(n: number): string {
  return n === 1 ? "1 scope line" : `${n} scope lines`;
}

/**
 * Un-confirm, when nothing has gone out yet.
 *
 * Refused once an RFP is live: the way back from there is withdrawing the
 * requests, which un-confirms as part of the same act. Two routes to the same
 * state, one of which skips telling the vendors, is how the scope and the
 * quotes come apart.
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
): Promise<DirectAwardResult> {
  if (!reason.trim()) return { ok: false, error: "Say why this is not going out for bid" };
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) return { ok: false, error: "Enter an amount" };

  const vendor = await db().query.vendors.findFirst({
    where: and(eq(schema.vendors.id, vendorId), eq(schema.vendors.active, true)),
    columns: { id: true },
  });
  if (!vendor) return { ok: false, error: "That vendor is not active" };

  // The same precondition sendBidPackageRows enforces. Without it a direct
  // award met gate 3 while gate 2 was still open — work committed against a
  // scope nobody had signed off, and against no approved budget, since the
  // budget requirement lives on the confirm step.
  const project = await db().query.projects.findFirst({
    where: eq(schema.projects.id, projectId),
    columns: { scopeConfirmedAt: true },
  });
  if (!project) return { ok: false, error: "Project not found" };
  if (!project.scopeConfirmedAt) {
    return { ok: false, error: "Confirm the scope and budget before awarding" };
  }

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
  await db().transaction(async (tx) => {
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

    // The whole amount lands on the first line rather than being split evenly
    // across the scope. A direct award is one agreed number, and inventing a
    // per-line breakdown nobody quoted would look like data.
    await tx.insert(schema.bidLineItems).values(
      items.map((it, n) => ({
        bidId: bid.id,
        scopeItemId: it.id,
        description: it.item,
        amount: n === 0 ? value.toFixed(2) : "0.00",
        sortOrder: n,
      })),
    );

  });

  // What setBidWinner does when a bid is awarded the normal way. Leaving it out
  // made a directly-awarded project read as $0 committed with no vendor — on
  // its own header, and in every portfolio rollup of committed cost. Recomputed
  // rather than assigned, because this award may be one of several.
  await applyAwardVendor(projectId, bidId);
  await recomputeCommittedCost(projectId);
  await syncProjectVendor(projectId);

  return { ok: true, bidId };
}

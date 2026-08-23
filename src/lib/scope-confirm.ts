import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";

// ---------------------------------------------------------------------------
// Confirming the scope, and taking it back.
//
// Plain functions rather than the actions, so they can be exercised without a
// request — revalidatePath throws outside one.
// ---------------------------------------------------------------------------

export type ConfirmResult = { ok: true } | { ok: false; error: string };

/** Confirm the scope as ready to price. */
export async function confirmScopeRows(projectId: number): Promise<ConfirmResult> {
  const [row] = await db()
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.scopeItems)
    .where(and(eq(schema.scopeItems.projectId, projectId), isNull(schema.scopeItems.archivedAt)));
  if ((row?.n ?? 0) === 0) return { ok: false, error: "There is no scope to confirm" };

  await db()
    .update(schema.projects)
    .set({ scopeConfirmedAt: new Date() })
    .where(eq(schema.projects.id, projectId));
  return { ok: true };
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
): Promise<DirectAwardResult> {
  if (!reason.trim()) return { ok: false, error: "Say why this is not going out for bid" };
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) return { ok: false, error: "Enter an amount" };

  const vendor = await db().query.vendors.findFirst({
    where: and(eq(schema.vendors.id, vendorId), eq(schema.vendors.active, true)),
    columns: { id: true },
  });
  if (!vendor) return { ok: false, error: "That vendor is not active" };

  const existing = await db().query.bids.findFirst({
    where: and(
      eq(schema.bids.projectId, projectId),
      eq(schema.bids.approved, true),
      isNull(schema.bids.archivedAt),
    ),
    columns: { id: true },
  });
  if (existing) return { ok: false, error: "This project already has a selected bid" };

  const [{ maxNumber }] = await db()
    .select({ maxNumber: sql<number>`coalesce(max(${schema.bids.bidNumber}), 0)::int` })
    .from(schema.bids)
    .where(eq(schema.bids.projectId, projectId));

  const items = await db()
    .select({ id: schema.scopeItems.id, item: schema.scopeItems.item })
    .from(schema.scopeItems)
    .where(and(eq(schema.scopeItems.projectId, projectId), isNull(schema.scopeItems.archivedAt)));
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

  return { ok: true, bidId };
}

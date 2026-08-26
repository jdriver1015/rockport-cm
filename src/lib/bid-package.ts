import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { scopeLineTotal } from "@/lib/scope-total";

// ---------------------------------------------------------------------------
// Sending a scope out for pricing.
//
// An RFP and a returned bid are the same row: a bid with a line per scope item.
// Sending seeds those lines at zero and the vendor fills them in, so there is no
// separate request table that could drift from what was actually quoted.
//
// Plain functions, not the actions — so they can be exercised without a request.
// ---------------------------------------------------------------------------

/**
 * Statuses that mean an RFP is still live with that vendor.
 *
 * Withdrawn is not among them: a request pulled back so the scope could change
 * is finished, and that vendor should be sent the new one.
 */
const OPEN_STATUSES = ["draft", "sent"] as const;

export type BidPackageOption = {
  scopeItems: {
    id: number;
    item: string;
    costCodeName: string | null;
    /** What the scope itself says this line should cost, for comparison. */
    budgeted: number | null;
  }[];
  vendors: { id: number; name: string; trade: string | null; contactCount: number }[];
  bids: {
    id: number;
    bidNumber: number;
    vendorId: number | null;
    vendorName: string | null;
    status: string;
    sentAt: Date | null;
    receivedDate: string | null;
    approved: boolean;
    lineCount: number;
    total: number;
    /** The live portal link for this bid, if one has been issued. */
    token: string | null;
    tokenExpiresAt: Date | null;
  }[];
  /**
   * What each vendor put against each scope line.
   *
   * A total per bid tells you Ace was cheaper overall; it cannot tell you Ace
   * was cheaper on countertops and dearer on cabinets, which is the whole
   * question when several vendors price the same scope. Absent means that
   * vendor was never asked to price that line, which is different from zero.
   */
  lineAmounts: { bidId: number; scopeItemId: number; amount: number }[];
};

/** Everything the Select Bid dialog needs, in one read. */
export async function readBidPackage(
  propertyId: number,
  projectId: number,
): Promise<BidPackageOption> {
  const [scopeItems, vendors, bids, tokens, lineRows] = await Promise.all([
    db()
      .select({
        id: schema.scopeItems.id,
        item: schema.scopeItems.item,
        costCodeName: schema.costCodes.name,
        quantity: schema.scopeItems.quantity,
        unitPrice: schema.scopeItems.unitPrice,
      })
      .from(schema.scopeItems)
      .leftJoin(schema.costCodes, eq(schema.costCodes.id, schema.scopeItems.costCodeId))
      .where(and(eq(schema.scopeItems.projectId, projectId), isNull(schema.scopeItems.archivedAt)))
      .orderBy(asc(schema.scopeItems.sortOrder), asc(schema.scopeItems.id)),
    db()
      .select({
        id: schema.vendors.id,
        name: schema.vendors.name,
        trade: schema.vendors.trade,
        contactCount: sql<number>`count(${schema.vendorContacts.id})::int`,
      })
      .from(schema.vendors)
      .leftJoin(
        schema.vendorContacts,
        and(
          eq(schema.vendorContacts.vendorId, schema.vendors.id),
          eq(schema.vendorContacts.active, true),
        ),
      )
      .where(eq(schema.vendors.active, true))
      .groupBy(schema.vendors.id, schema.vendors.name, schema.vendors.trade)
      .orderBy(asc(schema.vendors.name)),
    db()
      .select({
        id: schema.bids.id,
        bidNumber: schema.bids.bidNumber,
        vendorId: schema.bids.vendorId,
        vendorName: schema.vendors.name,
        status: schema.bids.status,
        sentAt: schema.bids.sentAt,
        receivedDate: schema.bids.receivedDate,
        approved: schema.bids.approved,
        lineCount: sql<number>`count(${schema.bidLineItems.id})::int`,
        total: sql<number>`coalesce(sum(${schema.bidLineItems.amount}), 0)::float8`,
      })
      .from(schema.bids)
      .leftJoin(schema.vendors, eq(schema.vendors.id, schema.bids.vendorId))
      .leftJoin(schema.bidLineItems, eq(schema.bidLineItems.bidId, schema.bids.id))
      .where(and(eq(schema.bids.projectId, projectId), isNull(schema.bids.archivedAt)))
      .groupBy(
        schema.bids.id,
        schema.bids.bidNumber,
        schema.bids.vendorId,
        schema.vendors.name,
        schema.bids.status,
        schema.bids.sentAt,
        schema.bids.receivedDate,
        schema.bids.approved,
      )
      .orderBy(asc(schema.bids.bidNumber)),
    // Live links only. An expired or revoked one is not a link the person can
    // hand out, so showing it would invite copying something already dead.
    db()
      .select({
        bidId: schema.bidAccessTokens.bidId,
        token: schema.bidAccessTokens.token,
        expiresAt: schema.bidAccessTokens.expiresAt,
      })
      .from(schema.bidAccessTokens)
      .innerJoin(schema.bids, eq(schema.bids.id, schema.bidAccessTokens.bidId))
      .where(
        and(
          eq(schema.bids.projectId, projectId),
          isNull(schema.bidAccessTokens.revokedAt),
          sql`${schema.bidAccessTokens.expiresAt} > now()`,
        ),
      ),
    // Every priced line on every live bid, for the comparison matrix. Manual
    // lines carry no scope item and are left out — they belong to a bid's total,
    // not to a row anybody can compare across vendors.
    db()
      .select({
        bidId: schema.bidLineItems.bidId,
        scopeItemId: schema.bidLineItems.scopeItemId,
        amount: schema.bidLineItems.amount,
      })
      .from(schema.bidLineItems)
      .innerJoin(schema.bids, eq(schema.bids.id, schema.bidLineItems.bidId))
      .where(and(eq(schema.bids.projectId, projectId), isNull(schema.bids.archivedAt))),
  ]);

  const tokenByBid = new Map(tokens.map((t) => [t.bidId, t]));

  void propertyId;
  return {
    scopeItems: scopeItems.map((s) => ({
      id: s.id,
      item: s.item,
      costCodeName: s.costCodeName,
      budgeted: scopeLineTotal(s),
    })),
    vendors,
    bids: bids.map((b) => ({
      ...b,
      token: tokenByBid.get(b.id)?.token ?? null,
      tokenExpiresAt: tokenByBid.get(b.id)?.expiresAt ?? null,
    })),
    lineAmounts: lineRows
      .filter((r): r is typeof r & { scopeItemId: number } => r.scopeItemId != null)
      .map((r) => ({
        bidId: r.bidId,
        scopeItemId: r.scopeItemId,
        amount: Number(r.amount),
      })),
  };
}

export type SendResult =
  | { ok: true; sent: number; skipped: { vendorId: number; reason: string }[] }
  | { ok: false; error: string };

/**
 * Send a scope out to one or more vendors.
 *
 * Each vendor gets its own bid so their prices never share a row, numbered per
 * project. The line's description snapshots the scope text at send time: editing
 * the scope afterwards must not silently rewrite what a vendor was asked to
 * quote.
 *
 * A vendor already holding a live RFP is skipped rather than sent a second one —
 * two open requests to the same vendor for the same project is a mistake, not a
 * feature. A vendor who previously declined or returned a bid can be sent a new
 * one, which is why only draft and sent count as live.
 */
export async function sendBidPackageRows(
  projectId: number,
  vendorIds: number[],
  scopeItemIds: number[],
): Promise<SendResult> {
  if (vendorIds.length === 0) return { ok: false, error: "Pick at least one vendor" };
  if (scopeItemIds.length === 0) return { ok: false, error: "Pick at least one scope item" };

  const project = await db().query.projects.findFirst({
    where: eq(schema.projects.id, projectId),
    columns: { id: true, scopeConfirmedAt: true },
  });
  if (!project) return { ok: false, error: "Project not found" };
  // Gate 2 before gate 3. Sending an unconfirmed scope is how a vendor ends up
  // pricing a draft, and it is also what makes the scope lock meaningful —
  // sending is the moment the scope stops being editable.
  if (!project.scopeConfirmedAt) {
    return { ok: false, error: "Confirm the scope before sending it out" };
  }

  // Only this project's scope. Without the filter a caller could put another
  // project's lines into this package.
  const items = await db()
    .select({ id: schema.scopeItems.id, item: schema.scopeItems.item })
    .from(schema.scopeItems)
    .where(
      and(
        eq(schema.scopeItems.projectId, projectId),
        isNull(schema.scopeItems.archivedAt),
        inArray(schema.scopeItems.id, scopeItemIds),
      ),
    )
    .orderBy(asc(schema.scopeItems.sortOrder), asc(schema.scopeItems.id));
  if (items.length === 0) {
    return { ok: false, error: "Those scope items aren't on this project" };
  }

  const vendors = await db()
    .select({ id: schema.vendors.id })
    .from(schema.vendors)
    .where(and(eq(schema.vendors.active, true), inArray(schema.vendors.id, vendorIds)));
  if (vendors.length === 0) return { ok: false, error: "No active vendors in that selection" };

  const live = await db()
    .select({ vendorId: schema.bids.vendorId })
    .from(schema.bids)
    .where(
      and(
        eq(schema.bids.projectId, projectId),
        isNull(schema.bids.archivedAt),
        inArray(schema.bids.status, [...OPEN_STATUSES]),
      ),
    );
  const alreadyOut = new Set(live.map((b) => b.vendorId).filter((v): v is number => v != null));

  const skipped = vendors
    .filter((v) => alreadyOut.has(v.id))
    .map((v) => ({ vendorId: v.id, reason: "already has a live request" }));
  const targets = vendors.filter((v) => !alreadyOut.has(v.id));
  if (targets.length === 0) return { ok: true, sent: 0, skipped };

  const [{ maxNumber }] = await db()
    .select({ maxNumber: sql<number>`coalesce(max(${schema.bids.bidNumber}), 0)::int` })
    .from(schema.bids)
    .where(eq(schema.bids.projectId, projectId));

  // One transaction: a half-sent package would leave a vendor holding a request
  // with no lines to price.
  await db().transaction(async (tx) => {
    for (const [i, vendor] of targets.entries()) {
      const [bid] = await tx
        .insert(schema.bids)
        .values({
          projectId,
          vendorId: vendor.id,
          bidNumber: maxNumber + 1 + i,
          status: "sent",
          sentAt: new Date(),
        })
        .returning({ id: schema.bids.id });

      await tx.insert(schema.bidLineItems).values(
        items.map((it, n) => ({
          bidId: bid.id,
          scopeItemId: it.id,
          description: it.item,
          amount: "0.00",
          sortOrder: n,
        })),
      );
    }
  });

  return { ok: true, sent: targets.length, skipped };
}

import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { recordBidEvent } from "@/lib/bid-events";

// ---------------------------------------------------------------------------
// The vendor portal's data layer.
//
// Everything here is keyed by TOKEN, never by session. That is the whole security
// model: a portal request has no user, so any query that took a project id or a
// bid id from the caller would be an open door. The token is looked up first and
// the bid it resolves to is the only bid the request can touch.
// ---------------------------------------------------------------------------

/** How long a fresh link lives. Long enough for a bid round, short enough to expire. */
export const TOKEN_TTL_DAYS = 30;

export type PortalBid = {
  bidId: number;
  bidNumber: number;
  vendorName: string | null;
  propertyName: string;
  projectName: string;
  status: string;
  /** Already submitted — the form goes read-only rather than accepting a rewrite. */
  submitted: boolean;
  expiresAt: Date;
  lines: { id: number; description: string; amount: number }[];
};

export type PortalLookup =
  | { ok: true; bid: PortalBid }
  | { ok: false; reason: "unknown" | "expired" | "revoked" };

/**
 * Resolve a token to the one bid it authorises.
 *
 * Returns a reason rather than a boolean so the page can say "this link has
 * expired" instead of "not found" — a vendor staring at a dead link needs to know
 * whether to ask for a new one.
 */
export async function lookupPortalBid(token: string): Promise<PortalLookup> {
  // Guard the shape before hitting the database: a token is fixed-length
  // base64url, so anything else is not a candidate.
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return { ok: false, reason: "unknown" };

  const [row] = await db()
    .select({
      tokenId: schema.bidAccessTokens.id,
      expiresAt: schema.bidAccessTokens.expiresAt,
      revokedAt: schema.bidAccessTokens.revokedAt,
      bidId: schema.bids.id,
      bidNumber: schema.bids.bidNumber,
      status: schema.bids.status,
      bidArchivedAt: schema.bids.archivedAt,
      vendorName: schema.vendors.name,
      projectName: schema.projects.name,
      propertyName: schema.properties.name,
    })
    .from(schema.bidAccessTokens)
    .innerJoin(schema.bids, eq(schema.bids.id, schema.bidAccessTokens.bidId))
    .innerJoin(schema.projects, eq(schema.projects.id, schema.bids.projectId))
    .innerJoin(schema.properties, eq(schema.properties.id, schema.projects.propertyId))
    .leftJoin(schema.vendors, eq(schema.vendors.id, schema.bids.vendorId))
    .where(eq(schema.bidAccessTokens.token, token))
    .limit(1);

  if (!row) return { ok: false, reason: "unknown" };
  if (row.revokedAt) return { ok: false, reason: "revoked" };
  if (row.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "expired" };
  // An archived bid reads as unknown rather than revoked: the vendor does not
  // need to know the request was withdrawn internally.
  if (row.bidArchivedAt) return { ok: false, reason: "unknown" };

  const lines = await db()
    .select({
      id: schema.bidLineItems.id,
      description: schema.bidLineItems.description,
      amount: schema.bidLineItems.amount,
    })
    .from(schema.bidLineItems)
    .where(eq(schema.bidLineItems.bidId, row.bidId))
    .orderBy(asc(schema.bidLineItems.sortOrder), asc(schema.bidLineItems.id));

  return {
    ok: true,
    bid: {
      bidId: row.bidId,
      bidNumber: row.bidNumber,
      vendorName: row.vendorName,
      propertyName: row.propertyName,
      projectName: row.projectName,
      status: row.status,
      // Anything past "sent" has been answered; reopening is an internal action.
      submitted: row.status !== "sent" && row.status !== "draft",
      expiresAt: row.expiresAt,
      lines: lines.map((l) => ({ id: l.id, description: l.description, amount: Number(l.amount) })),
    },
  };
}

export type SubmitResult =
  | { ok: true; total: number }
  | { ok: false; error: string };

/**
 * Record a vendor's prices against the bid a token authorises.
 *
 * The token is re-resolved here rather than trusted from the page — a submit is
 * its own request, and the link could have been revoked or the bid answered in
 * between. Only amounts on lines belonging to THIS bid are written; a line id
 * from anywhere else is ignored rather than erroring, since a stale form is not
 * the vendor's fault.
 */
export type DraftResult = { ok: true; saved: number } | { ok: false; error: string };

/**
 * Save what a vendor has typed without submitting it.
 *
 * A bid used to be all or nothing: type every price and press submit, or lose
 * the lot. A contractor pricing fifteen lines between site visits needs to come
 * back to it, and on our side "they have started" is the difference between
 * chasing somebody and leaving them alone.
 *
 * The bid stays at its current status — draft saving is not answering, so it
 * must not look like one on the comparison.
 */
export async function saveDraftPrices(
  token: string,
  amounts: { lineId: number; amount: number }[],
): Promise<DraftResult> {
  const found = await lookupPortalBid(token);
  if (!found.ok) return { ok: false, error: "This link is no longer valid." };
  // A submitted bid is a statement, not a working copy.
  if (found.bid.submitted) return { ok: false, error: "This bid has already been submitted." };

  const mine = new Set(found.bid.lines.map((l) => l.id));
  const valid = amounts.filter((a) => mine.has(a.lineId) && Number.isFinite(a.amount) && a.amount >= 0);
  if (valid.length === 0) return { ok: true, saved: 0 };

  await db().transaction(async (tx) => {
    for (const a of valid) {
      await tx
        .update(schema.bidLineItems)
        .set({ amount: a.amount.toFixed(2) })
        .where(
          and(eq(schema.bidLineItems.id, a.lineId), eq(schema.bidLineItems.bidId, found.bid.bidId)),
        );
    }
  });

  // De-duplicated the same way opens are: a keystroke is not a decision, and one
  // "priced" per hour is enough to answer "have they started".
  const [last] = await db()
    .select({ at: schema.bidEvents.at })
    .from(schema.bidEvents)
    .where(and(eq(schema.bidEvents.bidId, found.bid.bidId), eq(schema.bidEvents.kind, "priced")))
    .orderBy(desc(schema.bidEvents.at))
    .limit(1);
  if (!last || Date.now() - last.at.getTime() > 60 * 60 * 1000) {
    await recordBidEvent(found.bid.bidId, "priced", {
      lines: valid.filter((a) => a.amount > 0).length,
    });
  }

  return { ok: true, saved: valid.length };
}

export async function submitPortalBid(
  token: string,
  amounts: { lineId: number; amount: number }[],
  note: string | null,
): Promise<SubmitResult> {
  const found = await lookupPortalBid(token);
  if (!found.ok) {
    return {
      ok: false,
      error:
        found.reason === "expired"
          ? "This link has expired. Ask for a new one."
          : found.reason === "revoked"
            ? "This link has been withdrawn."
            : "This link is no longer valid.",
    };
  }
  if (found.bid.submitted) {
    return { ok: false, error: "This bid has already been submitted." };
  }

  const mine = new Map(found.bid.lines.map((l) => [l.id, l]));
  const valid = amounts.filter((a) => mine.has(a.lineId));
  if (valid.length === 0) return { ok: false, error: "Nothing to submit." };

  const total = valid.reduce((n, a) => n + a.amount, 0);
  // Priced then submitted, recorded as two things: a vendor who put numbers in
  // and a vendor who sent them are different states to chase.
  const pricedCount = valid.filter((a) => a.amount > 0).length;

  await db().transaction(async (tx) => {
    for (const a of valid) {
      await tx
        .update(schema.bidLineItems)
        .set({ amount: a.amount.toFixed(2) })
        .where(
          and(
            eq(schema.bidLineItems.id, a.lineId),
            // Belt and braces: the id came from the caller, so scope the write to
            // this bid even though it was checked above.
            eq(schema.bidLineItems.bidId, found.bid.bidId),
          ),
        );
    }
    await tx
      .update(schema.bids)
      .set({
        status: "received",
        receivedDate: new Date().toLocaleDateString("en-CA"),
        ...(note ? { note } : {}),
      })
      .where(eq(schema.bids.id, found.bid.bidId));
  });

  await recordBidEvent(found.bid.bidId, "submitted", {
    total,
    lines: valid.length,
    priced: pricedCount,
  });

  return { ok: true, total };
}

/**
 * Issue a fresh link for a bid, revoking whatever came before.
 *
 * Reissuing rather than reusing means a link handed to the wrong person can be
 * killed by making a new one, and the partial unique index guarantees only one is
 * ever live.
 */
export async function issueBidToken(
  bidId: number,
  createdBy: string | null,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + TOKEN_TTL_DAYS * 86_400_000);

  await db().transaction(async (tx) => {
    await tx
      .update(schema.bidAccessTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(schema.bidAccessTokens.bidId, bidId), isNull(schema.bidAccessTokens.revokedAt)));
    await tx.insert(schema.bidAccessTokens).values({ bidId, token, expiresAt, createdBy });
  });

  return { token, expiresAt };
}

/** Kill a bid's link without issuing a new one. */
export async function revokeBidToken(bidId: number): Promise<{ revoked: number }> {
  await recordBidEvent(bidId, "revoked");
  const rows = await db()
    .update(schema.bidAccessTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.bidAccessTokens.bidId, bidId), isNull(schema.bidAccessTokens.revokedAt)))
    .returning({ id: schema.bidAccessTokens.id });
  return { revoked: rows.length };
}

/** The live link for each bid on a project, for the internal dialog. */
export async function listBidTokens(projectId: number) {
  return db()
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
    );
}

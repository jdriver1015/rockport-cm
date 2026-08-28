import { asc, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";

// ---------------------------------------------------------------------------
// What happened to a bid request, in order.
//
// Sending one used to be a black hole: the row said "sent" and nothing
// afterwards said whether anybody opened the email, looked at the scope, or
// started pricing. Chasing a vendor is the most common thing anyone does with
// the bid screen, and it was being done blind.
// ---------------------------------------------------------------------------

export type BidEventKind =
  | "invited"
  | "email_opened"
  | "link_opened"
  | "priced"
  | "submitted"
  | "revoked";

export type BidEvent = {
  kind: BidEventKind;
  at: Date;
  meta: Record<string, string | number> | null;
};

/**
 * Record something the other side did.
 *
 * Never throws into the caller: this is a trail, and losing a row of it must not
 * fail the thing it was describing. A vendor who submits a bid has submitted it
 * whether or not we managed to write "submitted" beside it.
 */
export async function recordBidEvent(
  bidId: number,
  kind: BidEventKind,
  meta?: Record<string, string | number>,
): Promise<void> {
  try {
    await db().insert(schema.bidEvents).values({ bidId, kind, meta: meta ?? null });
  } catch (err) {
    console.error(`bid event ${kind} for bid ${bidId} failed to record`, err);
  }
}

/**
 * Record an event at most once an hour.
 *
 * A tracking pixel fires every time a mail client renders the message —
 * scrolling past it in a preview pane counts, and Gmail's proxy can fetch it on
 * its own. The portal page is the same: it re-renders on every visit and on the
 * router refresh that follows a submission. Recording each would report activity
 * nobody performed.
 *
 * One statement rather than a read followed by a write: two pixel fetches
 * arriving together both passed a separate SELECT and both inserted, which is
 * precisely the double count this exists to prevent.
 */
export async function recordOncePerHour(bidId: number, kind: BidEventKind): Promise<void> {
  try {
    await db().execute(sql`
      insert into bid_events (bid_id, kind)
      select ${bidId}, ${kind}::bid_event_kind
      where not exists (
        select 1 from bid_events
        where bid_id = ${bidId}
          and kind = ${kind}::bid_event_kind
          and at > now() - interval '1 hour'
      )
    `);
  } catch (err) {
    console.error(`bid event ${kind} for bid ${bidId} failed to record`, err);
  }
}

/** An email open, de-duplicated to the hour. */
export async function recordEmailOpen(bidId: number): Promise<void> {
  await recordOncePerHour(bidId, "email_opened");
}

/** The trail for a set of bids, oldest first. */
export async function readBidEvents(bidIds: number[]): Promise<Map<number, BidEvent[]>> {
  const out = new Map<number, BidEvent[]>();
  if (bidIds.length === 0) return out;

  const rows = await db()
    .select({
      bidId: schema.bidEvents.bidId,
      kind: schema.bidEvents.kind,
      at: schema.bidEvents.at,
      meta: schema.bidEvents.meta,
    })
    .from(schema.bidEvents)
    .where(inArray(schema.bidEvents.bidId, bidIds))
    .orderBy(asc(schema.bidEvents.at));

  for (const r of rows) {
    const list = out.get(r.bidId) ?? [];
    list.push({ kind: r.kind as BidEventKind, at: r.at, meta: r.meta });
    out.set(r.bidId, list);
  }
  return out;
}

/** The one line the bid screen shows per vendor: how far they have got. */
export type BidProgress = {
  invitedAt: Date | null;
  firstOpenedAt: Date | null;
  opens: number;
  lastSeenAt: Date | null;
  startedPricing: boolean;
  submittedAt: Date | null;
};

export function summarise(events: BidEvent[]): BidProgress {
  const first = (k: BidEventKind) => events.find((e) => e.kind === k)?.at ?? null;
  const last = (k: BidEventKind) => [...events].reverse().find((e) => e.kind === k)?.at ?? null;

  // "Seen" is either signal — a mail client that blocks images still tells us
  // something when the link is clicked, and a proxy that fetches the pixel tells
  // us something when the link never is.
  const seen = events.filter((e) => e.kind === "email_opened" || e.kind === "link_opened");

  return {
    invitedAt: first("invited"),
    firstOpenedAt: seen[0]?.at ?? null,
    opens: events.filter((e) => e.kind === "email_opened").length,
    lastSeenAt: seen.length ? seen[seen.length - 1].at : null,
    startedPricing: events.some((e) => e.kind === "priced"),
    submittedAt: last("submitted"),
  };
}

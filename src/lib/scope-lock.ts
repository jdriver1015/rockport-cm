import { and, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";

// ---------------------------------------------------------------------------
// The scope lock.
//
// Once an RFP is out, a vendor has priced these exact lines. Editing one
// afterwards means what was quoted and what is in the system have quietly come
// apart, and nobody finds out until an invoice does not match.
//
// So the lock is on SENDING, not on confirming. Confirm freely, edit freely,
// right up until the scope leaves the building. After that the only way back is
// withdrawing the requests, which is a deliberate act with a visible cost.
// ---------------------------------------------------------------------------

/**
 * Fields a vendor priced against.
 *
 * Deliberately not everything on a scope line. Scheduling a line, assigning it
 * to someone or marking it complete says nothing about what it costs, and
 * locking those would freeze the work the scope exists to track — a crew still
 * has to tick lines off during In Process.
 */
export const PRICED_FIELDS = [
  "item",
  "materialQuality",
  "quantity",
  "unitPrice",
  "costCodeId",
  "specs",
] as const;

export type PricedField = (typeof PRICED_FIELDS)[number];

/** Statuses where the vendor is still holding a live request. */
const LIVE_RFP_STATUSES = ["sent", "received"] as const;

/**
 * How many vendors are holding a live request for this project's scope.
 *
 * Withdrawn and declined do not count: nobody is relying on those lines any
 * more. Received does — a bid you are comparing was priced against this scope,
 * and editing under it would change what you think you are comparing.
 */
export async function liveRfpCount(projectId: number): Promise<number> {
  const [row] = await db()
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.bids)
    .where(
      and(
        eq(schema.bids.projectId, projectId),
        isNull(schema.bids.archivedAt),
        eq(schema.bids.source, "rfp"),
        sql`${schema.bids.status} = any(${sql.raw(`array['${LIVE_RFP_STATUSES.join("','")}']`)})`,
      ),
    );
  return row?.n ?? 0;
}

/**
 * Refuse an edit to what a vendor priced, if anyone is holding a live request.
 *
 * Returns an error message, or null when the edit may proceed. Callers pass the
 * fields they are actually changing so a scheduling edit is never blocked by a
 * pricing lock.
 */
export async function checkScopeEditable(
  projectId: number,
  changing: readonly string[],
): Promise<string | null> {
  const touchesPrice = changing.some((f) => (PRICED_FIELDS as readonly string[]).includes(f));
  if (!touchesPrice) return null;

  const live = await liveRfpCount(projectId);
  if (live === 0) return null;

  return `${live} vendor${live === 1 ? " is" : "s are"} pricing this scope. Withdraw the ${
    live === 1 ? "request" : "requests"
  } before changing what they were asked to quote.`;
}

/** Adding or removing a line always changes what was quoted. */
export function checkScopeStructureEditable(projectId: number): Promise<string | null> {
  return checkScopeEditable(projectId, ["item"]);
}

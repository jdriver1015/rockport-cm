import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { TRADE_HEADINGS } from "@/lib/trade-scope";

// ---------------------------------------------------------------------------
// Database operations over trade_scopes, at both levels. Kept out of the actions
// module so each is a plain function that can be exercised directly — the
// actions are validation and revalidation wrapped around these.
// ---------------------------------------------------------------------------

/**
 * Which of the two levels an operation is about. A tagged union rather than two
 * nullable ids, so "neither" and "both" cannot be expressed at the call site
 * either — the CHECK on the table catches them, but only after a round trip.
 */
export type ScopeOwnerRef =
  | { level: "template"; templateId: number }
  | { level: "group"; budgetGroupId: number; propertyId: number };

/** The where-clause for one owner's rows. */
function ownerWhere(owner: ScopeOwnerRef) {
  return owner.level === "template"
    ? and(
        eq(schema.tradeScopes.templateId, owner.templateId),
        isNull(schema.tradeScopes.budgetGroupId),
      )
    : and(
        eq(schema.tradeScopes.budgetGroupId, owner.budgetGroupId),
        isNull(schema.tradeScopes.templateId),
      );
}

function ownerColumns(owner: ScopeOwnerRef) {
  return owner.level === "template"
    ? { templateId: owner.templateId, budgetGroupId: null }
    : { templateId: null, budgetGroupId: owner.budgetGroupId };
}

/** Stable identity, so a copy onto itself is caught cheaply. */
export function ownerKey(owner: ScopeOwnerRef): string {
  return owner.level === "template" ? `t:${owner.templateId}` : `g:${owner.budgetGroupId}`;
}

/**
 * The ON CONFLICT specification for one owner's uniqueness.
 *
 * `targetWhere` is required, not decoration: the unique indexes are PARTIAL (one
 * per owner column, each predicated on that column being non-null, because a
 * plain unique index over a nullable pair constrains nothing — SQL NULLs are
 * distinct). Postgres will not infer a partial index from the column list alone,
 * and fails with 42P10.
 */
function conflictTarget(owner: ScopeOwnerRef) {
  return owner.level === "template"
    ? {
        target: [schema.tradeScopes.templateId, schema.tradeScopes.heading],
        targetWhere: isNotNull(schema.tradeScopes.templateId),
      }
    : {
        target: [schema.tradeScopes.budgetGroupId, schema.tradeScopes.heading],
        targetWhere: isNotNull(schema.tradeScopes.budgetGroupId),
      };
}

/** One owner's stored rows. Unwritten trades simply have no row. */
export async function listTradeScopeRows(owner: ScopeOwnerRef) {
  return db()
    .select({
      id: schema.tradeScopes.id,
      heading: schema.tradeScopes.heading,
      body: schema.tradeScopes.body,
      sortOrder: schema.tradeScopes.sortOrder,
    })
    .from(schema.tradeScopes)
    .where(ownerWhere(owner))
    .orderBy(asc(schema.tradeScopes.sortOrder));
}

/**
 * Write or rewrite one trade's scope.
 *
 * Clearing the text deletes the row rather than storing an empty string, so
 * "never written" and "written then emptied" stay the same state — otherwise the
 * completeness count and the bid sheet would disagree about whether a trade is
 * covered.
 */
export async function writeTradeScope(
  owner: ScopeOwnerRef,
  heading: string,
  rawBody: string | null | undefined,
): Promise<{ written: boolean }> {
  const body = rawBody?.trim() ?? "";

  if (!body) {
    await db()
      .delete(schema.tradeScopes)
      .where(and(ownerWhere(owner), eq(schema.tradeScopes.heading, heading)));
    return { written: false };
  }

  // Custom headings sort after the standard thirteen, in the order they were
  // added; a standard heading's position comes from the canonical list, so its
  // stored sortOrder is never read.
  const standardIndex = (TRADE_HEADINGS as readonly string[]).indexOf(heading);
  const sortOrder =
    standardIndex >= 0 ? standardIndex : TRADE_HEADINGS.length + (await nextCustomOrder(owner));

  await db()
    .insert(schema.tradeScopes)
    .values({ ...ownerColumns(owner), heading, body, sortOrder })
    .onConflictDoUpdate({
      ...conflictTarget(owner),
      set: { body, updatedAt: new Date() },
    });

  return { written: true };
}

async function nextCustomOrder(owner: ScopeOwnerRef): Promise<number> {
  const rows = await db()
    .select({ heading: schema.tradeScopes.heading })
    .from(schema.tradeScopes)
    .where(ownerWhere(owner));
  const known = new Set<string>(TRADE_HEADINGS);
  return rows.filter((r) => !known.has(r.heading)).length;
}

/** Remove a trade's scope entirely. A standard heading reverts to unwritten. */
export async function removeTradeScope(owner: ScopeOwnerRef, heading: string): Promise<void> {
  await db()
    .delete(schema.tradeScopes)
    .where(and(ownerWhere(owner), eq(schema.tradeScopes.heading, heading)));
}

/**
 * Copy one owner's written scopes onto another — "start from Signature", or pull
 * the portfolio standard down onto a property's type.
 *
 * Skips trades the target has already written unless told otherwise, because the
 * common case is filling gaps: a property writes its departures first and then
 * wants the standard wording for everything it did not touch. Overwriting that
 * by default would silently discard the specific in favour of the generic.
 */
export async function copyTradeScopeRows(
  to: ScopeOwnerRef,
  from: ScopeOwnerRef,
  overwrite: boolean,
): Promise<{ ok: true; copied: number; skipped: number } | { ok: false; error: string }> {
  if (ownerKey(from) === ownerKey(to)) {
    return { ok: false, error: "Pick a different source to copy from" };
  }

  const [source, existing] = await Promise.all([
    listTradeScopeRows(from),
    listTradeScopeRows(to),
  ]);
  if (source.length === 0) return { ok: false, error: "That source has no written scopes yet" };

  const already = new Set(existing.map((r) => r.heading));
  const incoming = source.filter((r) => overwrite || !already.has(r.heading));
  const skipped = source.length - incoming.length;
  if (incoming.length === 0) return { ok: true, copied: 0, skipped };

  await db()
    .insert(schema.tradeScopes)
    .values(
      incoming.map((r) => ({
        ...ownerColumns(to),
        heading: r.heading,
        body: r.body,
        sortOrder: r.sortOrder,
      })),
    )
    .onConflictDoUpdate({
      ...conflictTarget(to),
      // The incoming row's text, not the existing one. Only reachable with
      // overwrite on — the non-overwrite path filters conflicts out above.
      set: { body: sql`excluded.body`, updatedAt: new Date() },
    });

  return { ok: true, copied: incoming.length, skipped };
}

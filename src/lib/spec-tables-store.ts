import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import {
  normalizeGrid,
  trimGrid,
  type SpecGrid,
  type SpecKind,
  type SpecTable,
} from "@/lib/spec-tables";
import type { ScopeOwnerRef } from "@/lib/trade-scope-store";

// ---------------------------------------------------------------------------
// Database operations over spec_tables. Same dual-owner shape as trade scopes,
// and the same reason for living outside the actions module: these are plain
// functions that can be exercised directly.
// ---------------------------------------------------------------------------

function ownerWhere(owner: ScopeOwnerRef) {
  return owner.level === "template"
    ? and(
        eq(schema.specTables.templateId, owner.templateId),
        isNull(schema.specTables.budgetGroupId),
      )
    : and(
        eq(schema.specTables.budgetGroupId, owner.budgetGroupId),
        isNull(schema.specTables.templateId),
      );
}

function ownerColumns(owner: ScopeOwnerRef) {
  return owner.level === "template"
    ? { templateId: owner.templateId, budgetGroupId: null }
    : { templateId: null, budgetGroupId: owner.budgetGroupId };
}

/**
 * ON CONFLICT for one owner's uniqueness. `targetWhere` matches the PARTIAL
 * unique index predicate — Postgres will not infer a partial index from the
 * column list alone and fails with 42P10. Same trap as trade_scopes.
 */
function conflictTarget(owner: ScopeOwnerRef) {
  return owner.level === "template"
    ? {
        target: [schema.specTables.templateId, schema.specTables.kind, schema.specTables.title],
        targetWhere: isNotNull(schema.specTables.templateId),
      }
    : {
        target: [schema.specTables.budgetGroupId, schema.specTables.kind, schema.specTables.title],
        targetWhere: isNotNull(schema.specTables.budgetGroupId),
      };
}

/** One owner's spec tables, grids normalized to rectangles. */
export async function listSpecTables(owner: ScopeOwnerRef): Promise<SpecTable[]> {
  const rows = await db()
    .select({
      id: schema.specTables.id,
      kind: schema.specTables.kind,
      title: schema.specTables.title,
      grid: schema.specTables.grid,
      sortOrder: schema.specTables.sortOrder,
      version: schema.specTables.version,
    })
    .from(schema.specTables)
    .where(ownerWhere(owner))
    .orderBy(asc(schema.specTables.sortOrder), asc(schema.specTables.id));

  return rows.map((r) => ({
    id: r.id,
    kind: r.kind as SpecKind,
    title: r.title,
    grid: normalizeGrid(r.grid),
    sortOrder: r.sortOrder,
    version: r.version,
  }));
}

/** Add a table, or return the existing one if that title is already present. */
export async function createSpecTable(
  owner: ScopeOwnerRef,
  kind: SpecKind,
  title: string,
  cols: string[],
): Promise<{ id: number; created: boolean }> {
  const existing = await db()
    .select({ id: schema.specTables.id })
    .from(schema.specTables)
    .where(
      and(ownerWhere(owner), eq(schema.specTables.kind, kind), eq(schema.specTables.title, title)),
    );
  if (existing.length > 0) return { id: existing[0].id, created: false };

  const [row] = await db()
    .insert(schema.specTables)
    .values({
      ...ownerColumns(owner),
      kind,
      title,
      grid: { cols, rows: [] },
      sortOrder: await nextOrder(owner),
    })
    .returning({ id: schema.specTables.id });
  return { id: row.id, created: true };
}

async function nextOrder(owner: ScopeOwnerRef): Promise<number> {
  const rows = await db()
    .select({ sortOrder: schema.specTables.sortOrder })
    .from(schema.specTables)
    .where(ownerWhere(owner));
  return rows.reduce((max, r) => Math.max(max, r.sortOrder), -1) + 1;
}

/**
 * Replace one table's grid.
 *
 * Blank rows are dropped on the way in, so an abandoned "+ Row" leaves nothing
 * behind and the row count means what it says. Scoped by owner as well as id so
 * a stale id from one type can't rewrite another's specs.
 *
 * `expectedVersion` makes this a compare-and-set. The editor holds a local
 * draft while someone fills in a paint schedule, so without it a second writer's
 * stale copy silently replaced whatever landed in between. Omitting it writes
 * unconditionally, which is what the copy path wants.
 */
export async function saveSpecGrid(
  owner: ScopeOwnerRef,
  id: number,
  grid: SpecGrid,
  expectedVersion?: number,
): Promise<{ ok: boolean; conflict?: boolean }> {
  const [row] = await db()
    .update(schema.specTables)
    .set({
      grid: trimGrid(normalizeGrid(grid)),
      version: sql`${schema.specTables.version} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        ownerWhere(owner),
        eq(schema.specTables.id, id),
        ...(expectedVersion != null ? [eq(schema.specTables.version, expectedVersion)] : []),
      ),
    )
    .returning({ id: schema.specTables.id });
  if (row) return { ok: true };

  // No row matched. Distinguish "gone" from "moved on", because the two need
  // different words: one is an error, the other is someone else's work to keep.
  if (expectedVersion == null) return { ok: false };
  const [still] = await db()
    .select({ id: schema.specTables.id })
    .from(schema.specTables)
    .where(and(ownerWhere(owner), eq(schema.specTables.id, id)));
  return { ok: false, conflict: !!still };
}

/** Rename a table. Returns false if the new title is already taken here. */
export async function renameSpecTable(
  owner: ScopeOwnerRef,
  id: number,
  title: string,
): Promise<{ ok: boolean; reason?: string }> {
  const mine = await db()
    .select({ id: schema.specTables.id, kind: schema.specTables.kind })
    .from(schema.specTables)
    .where(and(ownerWhere(owner), eq(schema.specTables.id, id)));
  if (mine.length === 0) return { ok: false, reason: "That spec table no longer exists" };

  const clash = await db()
    .select({ id: schema.specTables.id })
    .from(schema.specTables)
    .where(
      and(
        ownerWhere(owner),
        eq(schema.specTables.kind, mine[0].kind),
        eq(schema.specTables.title, title),
      ),
    );
  if (clash.some((c) => c.id !== id)) {
    return { ok: false, reason: `A table called "${title}" is already here` };
  }

  await db()
    .update(schema.specTables)
    .set({ title, updatedAt: new Date() })
    .where(and(ownerWhere(owner), eq(schema.specTables.id, id)));
  return { ok: true };
}

/** Remove a table and everything in it. */
export async function deleteSpecTable(owner: ScopeOwnerRef, id: number): Promise<{ ok: boolean }> {
  const [row] = await db()
    .delete(schema.specTables)
    .where(and(ownerWhere(owner), eq(schema.specTables.id, id)))
    .returning({ id: schema.specTables.id });
  return { ok: !!row };
}

/**
 * Copy one owner's spec tables onto another.
 *
 * Skips titles the target already has unless told to overwrite — same reasoning
 * as trade scope: a property's own paint schedule should survive pulling in the
 * standard for everything it hasn't specified.
 */
export async function copySpecTables(
  to: ScopeOwnerRef,
  from: ScopeOwnerRef,
  overwrite: boolean,
): Promise<{ ok: true; copied: number; skipped: number } | { ok: false; error: string }> {
  const key = (o: ScopeOwnerRef) =>
    o.level === "template" ? `t:${o.templateId}` : `g:${o.budgetGroupId}`;
  if (key(from) === key(to)) return { ok: false, error: "Pick a different source to copy from" };

  const [source, existing] = await Promise.all([listSpecTables(from), listSpecTables(to)]);
  if (source.length === 0) return { ok: false, error: "That source has no spec tables yet" };

  const already = new Set(existing.map((t) => `${t.kind}:${t.title}`));
  const incoming = source.filter((t) => overwrite || !already.has(`${t.kind}:${t.title}`));
  const skipped = source.length - incoming.length;
  if (incoming.length === 0) return { ok: true, copied: 0, skipped };

  // Sequential rather than one multi-row insert: the grid has to come from the
  // incoming row per conflict, and `excluded` can't be expressed per-value in a
  // batched upsert without hand-writing the statement. Wrapped in a transaction
  // so a failure part-way cannot leave a spec sheet holding some tables and not
  // others — a GC would bid off it with nothing indicating the gap.
  await db().transaction(async (tx) => {
    for (const t of incoming) {
      await tx
        .insert(schema.specTables)
        .values({
          ...ownerColumns(to),
          kind: t.kind,
          title: t.title,
          grid: t.grid,
          sortOrder: t.sortOrder,
        })
        .onConflictDoUpdate({
          ...conflictTarget(to),
          set: { grid: t.grid, updatedAt: new Date() },
        });
    }
  });

  return { ok: true, copied: incoming.length, skipped };
}

"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import type { ActionResult } from "@/lib/action-result";
import { num } from "@/lib/format";
import { propertyPath } from "@/lib/property-path";
import {
  proposeUnitGroups,
  reconcileUnitGroups,
  suggestSqftBreakpoints,
  type FloorplanFacts,
  type GroupingMode,
} from "@/lib/interior-unit-grouping";

// ---------------------------------------------------------------------------
// Unit groups — the interior budget pivot's columns.
//
// Seeded from the latest committed rent roll, then freely editable. The one hard
// rule: seeding and refreshing RECONCILE rather than truncate. Pins and plan
// rows cascade on unit-group delete, so rebuilding groups from scratch would
// silently destroy negotiated prices and penetration settings.
// ---------------------------------------------------------------------------

const MODES = ["beds", "floorplan", "sqft"] as const;

async function revalidateBudget(propertyId: number) {
  const path = await propertyPath(propertyId, "/budget");
  if (path) revalidatePath(path);
}

/** Aggregate the latest committed rent roll into per-floorplan facts. */
async function loadFloorplanFacts(propertyId: number): Promise<FloorplanFacts[]> {
  const [batch] = await db()
    .select({ id: schema.rentRollBatches.id })
    .from(schema.rentRollBatches)
    .where(
      and(
        eq(schema.rentRollBatches.propertyId, propertyId),
        eq(schema.rentRollBatches.status, "committed"),
        isNull(schema.rentRollBatches.archivedAt),
      ),
    )
    .orderBy(desc(schema.rentRollBatches.asOfDate), desc(schema.rentRollBatches.createdAt))
    .limit(1);
  if (!batch) return [];

  const units = await db()
    .select({
      floorPlanCode: schema.rentRollUnits.floorPlanCode,
      squareFeet: schema.rentRollUnits.squareFeet,
      beds: schema.rentRollUnits.beds,
      baths: schema.rentRollUnits.baths,
    })
    .from(schema.rentRollUnits)
    .where(eq(schema.rentRollUnits.batchId, batch.id));

  type Acc = {
    count: number;
    sqftTotal: number;
    sqftCount: number;
    beds: Map<number, number>;
    baths: Map<number, number>;
  };
  const acc = new Map<string, Acc>();
  for (const u of units) {
    const code = u.floorPlanCode ?? "";
    const a =
      acc.get(code) ?? { count: 0, sqftTotal: 0, sqftCount: 0, beds: new Map(), baths: new Map() };
    a.count += 1;
    if (u.squareFeet != null) {
      a.sqftTotal += u.squareFeet;
      a.sqftCount += 1;
    }
    if (u.beds != null) a.beds.set(u.beds, (a.beds.get(u.beds) ?? 0) + 1);
    if (u.baths != null) {
      const b = num(u.baths);
      a.baths.set(b, (a.baths.get(b) ?? 0) + 1);
    }
    acc.set(code, a);
  }

  const modeOf = (m: Map<number, number>): number | null => {
    let best: number | null = null;
    let bestCount = -1;
    for (const [v, c] of m) if (c > bestCount) [best, bestCount] = [v, c];
    return best;
  };

  return [...acc.entries()].map(([floorPlanCode, a]) => ({
    floorPlanCode,
    count: a.count,
    avgSqft: a.sqftCount > 0 ? Math.round((a.sqftTotal / a.sqftCount) * 100) / 100 : null,
    bedrooms: modeOf(a.beds),
    baths: modeOf(a.baths),
  }));
}

async function loadExistingGroups(propertyId: number) {
  const [groups, floorplans] = await Promise.all([
    db()
      .select()
      .from(schema.interiorUnitGroups)
      .where(eq(schema.interiorUnitGroups.propertyId, propertyId)),
    db()
      .select()
      .from(schema.interiorUnitGroupFloorplans)
      .where(eq(schema.interiorUnitGroupFloorplans.propertyId, propertyId)),
  ]);
  const codesByGroup = new Map<number, string[]>();
  for (const f of floorplans) {
    const list = codesByGroup.get(f.unitGroupId) ?? [];
    list.push(f.floorPlanCode);
    codesByGroup.set(f.unitGroupId, list);
  }
  return groups.map((g) => ({
    id: g.id,
    name: g.name,
    floorPlanCodes: codesByGroup.get(g.id) ?? [],
  }));
}

/** What a unit group takes with it if deleted. The confirmation depends on this. */
export type GroupLoss = { id: number; name: string; pinCount: number; plannedTierCount: number };

async function lossesFor(propertyId: number, groupIds: number[]): Promise<GroupLoss[]> {
  if (groupIds.length === 0) return [];
  const [groups, pins, plan] = await Promise.all([
    db()
      .select({ id: schema.interiorUnitGroups.id, name: schema.interiorUnitGroups.name })
      .from(schema.interiorUnitGroups)
      .where(
        and(
          eq(schema.interiorUnitGroups.propertyId, propertyId),
          inArray(schema.interiorUnitGroups.id, groupIds),
        ),
      ),
    db()
      .select({
        unitGroupId: schema.interiorBudgetLineOverrides.unitGroupId,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.interiorBudgetLineOverrides)
      .where(
        and(
          eq(schema.interiorBudgetLineOverrides.propertyId, propertyId),
          inArray(schema.interiorBudgetLineOverrides.unitGroupId, groupIds),
        ),
      )
      .groupBy(schema.interiorBudgetLineOverrides.unitGroupId),
    db()
      .select({
        unitGroupId: schema.interiorBudgetPlan.unitGroupId,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.interiorBudgetPlan)
      .where(
        and(
          eq(schema.interiorBudgetPlan.propertyId, propertyId),
          inArray(schema.interiorBudgetPlan.unitGroupId, groupIds),
        ),
      )
      .groupBy(schema.interiorBudgetPlan.unitGroupId),
  ]);
  const pinByGroup = new Map(pins.map((p) => [p.unitGroupId, p.count]));
  const planByGroup = new Map(plan.map((p) => [p.unitGroupId, p.count]));
  return groups.map((g) => ({
    id: g.id,
    name: g.name,
    pinCount: pinByGroup.get(g.id) ?? 0,
    plannedTierCount: planByGroup.get(g.id) ?? 0,
  }));
}

const groupingInput = z.object({
  propertyId: z.coerce.number().int().positive(),
  mode: z.enum(MODES),
  sqftBreakpoints: z.array(z.coerce.number().positive()).optional().nullable(),
});

/**
 * Show what re-seeding would do without touching anything. The UI must call this
 * and surface `remove` before calling `applyGrouping` with `confirm`.
 */
export async function previewGrouping(
  input: z.input<typeof groupingInput>,
): Promise<
  ActionResult<{
    keep: { id: number; name: string }[];
    create: { name: string; floorPlanCodes: string[] }[];
    remove: GroupLoss[];
    suggestedBreakpoints: number[];
    hasRentRoll: boolean;
  }>
> {
  const parsed = groupingInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { propertyId, mode, sqftBreakpoints } = parsed.data;

  const facts = await loadFloorplanFacts(propertyId);
  const proposed = proposeUnitGroups(facts, mode as GroupingMode, sqftBreakpoints);
  const existing = await loadExistingGroups(propertyId);
  const { keep, create, remove } = reconcileUnitGroups(existing, proposed);

  return {
    ok: true,
    keep,
    create: create.map((c) => ({ name: c.name, floorPlanCodes: c.floorPlanCodes })),
    remove: await lossesFor(propertyId, remove.map((r) => r.id)),
    suggestedBreakpoints: suggestSqftBreakpoints(facts),
    hasRentRoll: facts.length > 0,
  };
}

/**
 * Apply a grouping. Refuses to run when it would drop a group unless the caller
 * has confirmed, because dropping a group cascades its pins and plan rows away.
 */
export async function applyGrouping(
  input: z.input<typeof groupingInput> & { confirm?: boolean },
): Promise<ActionResult<{ kept: number; created: number; removed: number }>> {
  const parsed = groupingInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { propertyId, mode, sqftBreakpoints } = parsed.data;

  const facts = await loadFloorplanFacts(propertyId);
  if (facts.length === 0) {
    return {
      ok: false,
      error: "No committed rent roll for this property — import one, or add unit groups by hand.",
    };
  }

  const proposed = proposeUnitGroups(facts, mode as GroupingMode, sqftBreakpoints);
  const existing = await loadExistingGroups(propertyId);
  const { keep, create, remove } = reconcileUnitGroups(existing, proposed);

  if (remove.length > 0 && !input.confirm) {
    const losses = await lossesFor(propertyId, remove.map((r) => r.id));
    const costly = losses.filter((l) => l.pinCount > 0 || l.plannedTierCount > 0);
    const detail = costly.length
      ? costly
          .map(
            (l) =>
              `"${l.name}" (${l.pinCount} pinned amount${l.pinCount === 1 ? "" : "s"}, ${l.plannedTierCount} planned tier${l.plannedTierCount === 1 ? "" : "s"})`,
          )
          .join(", ")
      : remove.map((r) => `"${r.name}"`).join(", ");
    return { ok: false, error: `This would remove ${detail}. Confirm to continue.` };
  }

  const [batch] = await db()
    .select({ id: schema.rentRollBatches.id })
    .from(schema.rentRollBatches)
    .where(
      and(
        eq(schema.rentRollBatches.propertyId, propertyId),
        eq(schema.rentRollBatches.status, "committed"),
        isNull(schema.rentRollBatches.archivedAt),
      ),
    )
    .orderBy(desc(schema.rentRollBatches.asOfDate), desc(schema.rentRollBatches.createdAt))
    .limit(1);

  await db().transaction(async (tx) => {
    if (remove.length > 0) {
      // Floorplan mappings, pins and plan rows all cascade from here.
      await tx
        .delete(schema.interiorUnitGroups)
        .where(inArray(schema.interiorUnitGroups.id, remove.map((r) => r.id)));
    }

    let order = 0;
    for (const p of proposed) {
      // Match by reference, not name — a surviving group the user renamed still
      // maps to its proposal, and matching on name would duplicate it.
      const kept = keep.find((k) => k.proposed === p);
      if (kept) {
        // Surviving group: only re-point sortOrder and the source batch. Its
        // name stays as the user left it.
        await tx
          .update(schema.interiorUnitGroups)
          .set({ sortOrder: order, sourceBatchId: batch?.id ?? null })
          .where(eq(schema.interiorUnitGroups.id, kept.id));
      } else {
        const [row] = await tx
          .insert(schema.interiorUnitGroups)
          .values({
            propertyId,
            name: p.name,
            bedrooms: p.bedrooms,
            baths: p.baths != null ? p.baths.toFixed(1) : null,
            sourceBatchId: batch?.id ?? null,
            sortOrder: order,
          })
          .returning({ id: schema.interiorUnitGroups.id });
        if (p.floorPlanCodes.length > 0) {
          await tx.insert(schema.interiorUnitGroupFloorplans).values(
            p.floorPlanCodes.map((floorPlanCode) => ({
              propertyId,
              unitGroupId: row.id,
              floorPlanCode,
            })),
          );
        }
      }
      order++;
    }

    // Remember the mode so a later refresh re-applies the user's choice.
    await tx
      .insert(schema.interiorBudgetSettings)
      .values({
        propertyId,
        groupingMode: mode,
        sqftBreakpoints: sqftBreakpoints ?? null,
      })
      .onConflictDoUpdate({
        target: schema.interiorBudgetSettings.propertyId,
        set: { groupingMode: mode, sqftBreakpoints: sqftBreakpoints ?? null, updatedAt: new Date() },
      });
  });

  await revalidateBudget(propertyId);
  return { ok: true, kept: keep.length, created: create.length, removed: remove.length };
}

const updateSchema = z.object({
  id: z.coerce.number().int().positive(),
  propertyId: z.coerce.number().int().positive(),
  name: z.string().trim().min(1, "Name is required"),
  bedrooms: z.coerce.number().int().nonnegative().optional().nullable(),
  baths: z.coerce.number().nonnegative().optional().nullable(),
  /** Blank clears the override and returns the figure to rent-roll derivation. */
  unitCountOverride: z.coerce.number().int().nonnegative().optional().nullable(),
  avgSqftOverride: z.coerce.number().nonnegative().optional().nullable(),
});

export async function updateUnitGroup(
  input: z.input<typeof updateSchema>,
): Promise<ActionResult> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const d = parsed.data;

  const group = await db().query.interiorUnitGroups.findFirst({
    where: eq(schema.interiorUnitGroups.id, d.id),
  });
  if (!group || group.propertyId !== d.propertyId) {
    return { ok: false, error: "Unit group not found for this property" };
  }

  await db()
    .update(schema.interiorUnitGroups)
    .set({
      name: d.name,
      bedrooms: d.bedrooms ?? null,
      baths: d.baths != null ? d.baths.toFixed(1) : null,
      unitCountOverride: d.unitCountOverride ?? null,
      avgSqftOverride: d.avgSqftOverride != null ? d.avgSqftOverride.toFixed(2) : null,
    })
    .where(eq(schema.interiorUnitGroups.id, d.id));

  await revalidateBudget(d.propertyId);
  return { ok: true };
}

const mergeSchema = z.object({
  propertyId: z.coerce.number().int().positive(),
  targetId: z.coerce.number().int().positive(),
  sourceIds: z.array(z.coerce.number().int().positive()).min(1, "Pick at least one group to merge"),
});

/**
 * Fold other groups' floorplans into a target group. The sources are deleted, so
 * their pins and plan rows go with them — the target's are untouched.
 */
export async function mergeUnitGroups(
  input: z.input<typeof mergeSchema>,
): Promise<ActionResult<{ moved: number }>> {
  const parsed = mergeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { propertyId, targetId, sourceIds } = parsed.data;
  if (sourceIds.includes(targetId)) return { ok: false, error: "A group can't be merged into itself" };

  const groups = await db()
    .select({ id: schema.interiorUnitGroups.id, propertyId: schema.interiorUnitGroups.propertyId })
    .from(schema.interiorUnitGroups)
    .where(inArray(schema.interiorUnitGroups.id, [targetId, ...sourceIds]));
  if (groups.length !== sourceIds.length + 1 || groups.some((g) => g.propertyId !== propertyId)) {
    return { ok: false, error: "One or more unit groups don't belong to this property" };
  }

  const moved = await db().transaction(async (tx) => {
    const res = await tx
      .update(schema.interiorUnitGroupFloorplans)
      .set({ unitGroupId: targetId })
      .where(inArray(schema.interiorUnitGroupFloorplans.unitGroupId, sourceIds))
      .returning({ id: schema.interiorUnitGroupFloorplans.id });
    await tx.delete(schema.interiorUnitGroups).where(inArray(schema.interiorUnitGroups.id, sourceIds));
    return res.length;
  });

  await revalidateBudget(propertyId);
  return { ok: true, moved };
}

const splitSchema = z.object({
  propertyId: z.coerce.number().int().positive(),
  unitGroupId: z.coerce.number().int().positive(),
  name: z.string().trim().min(1, "Name is required"),
  floorPlanCodes: z.array(z.string().trim()).min(1, "Pick at least one floorplan to split out"),
});

/** Move some floorplans out of a group into a new one. The original keeps its pins. */
export async function splitUnitGroup(
  input: z.input<typeof splitSchema>,
): Promise<ActionResult<{ unitGroupId: number }>> {
  const parsed = splitSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const d = parsed.data;

  const source = await db().query.interiorUnitGroups.findFirst({
    where: eq(schema.interiorUnitGroups.id, d.unitGroupId),
  });
  if (!source || source.propertyId !== d.propertyId) {
    return { ok: false, error: "Unit group not found for this property" };
  }

  const owned = await db()
    .select({ floorPlanCode: schema.interiorUnitGroupFloorplans.floorPlanCode })
    .from(schema.interiorUnitGroupFloorplans)
    .where(eq(schema.interiorUnitGroupFloorplans.unitGroupId, d.unitGroupId));
  const ownedCodes = new Set(owned.map((o) => o.floorPlanCode));
  if (!d.floorPlanCodes.every((c) => ownedCodes.has(c))) {
    return { ok: false, error: "A selected floorplan isn't in this group" };
  }
  if (d.floorPlanCodes.length === ownedCodes.size) {
    return { ok: false, error: "That would move every floorplan — rename the group instead" };
  }

  const [{ maxOrder }] = await db()
    .select({ maxOrder: sql<number>`coalesce(max(${schema.interiorUnitGroups.sortOrder}), 0)::int` })
    .from(schema.interiorUnitGroups)
    .where(eq(schema.interiorUnitGroups.propertyId, d.propertyId));

  const unitGroupId = await db().transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.interiorUnitGroups)
      .values({
        propertyId: d.propertyId,
        name: d.name,
        bedrooms: source.bedrooms,
        baths: source.baths,
        sourceBatchId: source.sourceBatchId,
        sortOrder: maxOrder + 1,
      })
      .returning({ id: schema.interiorUnitGroups.id });
    await tx
      .update(schema.interiorUnitGroupFloorplans)
      .set({ unitGroupId: row.id })
      .where(
        and(
          eq(schema.interiorUnitGroupFloorplans.unitGroupId, d.unitGroupId),
          inArray(schema.interiorUnitGroupFloorplans.floorPlanCode, d.floorPlanCodes),
        ),
      );
    return row.id;
  });

  await revalidateBudget(d.propertyId);
  return { ok: true, unitGroupId };
}

export async function deleteUnitGroup(input: {
  id: number;
  propertyId: number;
  confirm?: boolean;
}): Promise<ActionResult> {
  const id = Number(input.id);
  const propertyId = Number(input.propertyId);
  const group = await db().query.interiorUnitGroups.findFirst({
    where: eq(schema.interiorUnitGroups.id, id),
  });
  if (!group || group.propertyId !== propertyId) {
    return { ok: false, error: "Unit group not found for this property" };
  }

  const [loss] = await lossesFor(propertyId, [id]);
  if (loss && (loss.pinCount > 0 || loss.plannedTierCount > 0) && !input.confirm) {
    return {
      ok: false,
      error: `"${loss.name}" has ${loss.pinCount} pinned amount${loss.pinCount === 1 ? "" : "s"} and ${loss.plannedTierCount} planned tier${loss.plannedTierCount === 1 ? "" : "s"} that will be deleted. Confirm to continue.`,
    };
  }

  await db().delete(schema.interiorUnitGroups).where(eq(schema.interiorUnitGroups.id, id));
  await revalidateBudget(propertyId);
  return { ok: true };
}

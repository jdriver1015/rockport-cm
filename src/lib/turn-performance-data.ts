import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { num } from "@/lib/format";
import {
  computeTurnPerformance,
  type SnapshotRef,
  type SnapshotUnit,
  type TurnInput,
  type TurnPerformance,
} from "@/lib/turn-performance";

/**
 * Feeds src/lib/turn-performance.ts from the database.
 *
 * Split out so the derivation itself stays pure and testable — see the header
 * there. This module is only queries and shaping.
 */
export async function computeTurnPerformanceFor(propertyId: number): Promise<TurnPerformance> {
  // Every committed snapshot, oldest first. Unlike the rest of the app, which
  // wants only the newest roll, trade-out is precisely a comparison BETWEEN
  // snapshots, so the whole series is the input.
  const snapshotRows = await db()
    .select({
      batchId: schema.rentRollBatches.id,
      asOfDate: schema.rentRollBatches.asOfDate,
    })
    .from(schema.rentRollBatches)
    .where(
      and(
        eq(schema.rentRollBatches.propertyId, propertyId),
        eq(schema.rentRollBatches.status, "committed"),
        isNull(schema.rentRollBatches.archivedAt),
      ),
    )
    .orderBy(asc(schema.rentRollBatches.asOfDate), asc(schema.rentRollBatches.createdAt));

  const snapshots: SnapshotRef[] = snapshotRows
    .filter((r): r is { batchId: number; asOfDate: string } => r.asOfDate != null)
    .map((r) => ({ batchId: r.batchId, asOfDate: r.asOfDate }));

  const [turnRows, unitRows, costRows] = await Promise.all([
    db()
      .select({
        projectId: schema.projects.id,
        projectName: schema.projects.name,
        phase: schema.projects.phase,
        startDate: schema.projects.startDate,
        completeDate: schema.projects.completeDate,
        budgetAmount: schema.projects.budgetAmount,
        previousRent: schema.projects.previousRent,
        tradeOutRent: schema.projects.tradeOutRent,
        leaseDate: schema.projects.leaseDate,
        unitNumber: schema.units.unitNumber,
        floorplan: schema.units.floorplan,
        tierId: schema.budgetGroups.id,
        tierName: schema.budgetGroups.name,
        targetTradeOut: schema.budgetGroups.targetTradeOut,
      })
      .from(schema.projects)
      .innerJoin(schema.units, eq(schema.projects.unitId, schema.units.id))
      .leftJoin(schema.budgetGroups, eq(schema.projects.budgetGroupId, schema.budgetGroups.id))
      .where(
        and(
          eq(schema.projects.propertyId, propertyId),
          eq(schema.projects.kind, "unit"),
          isNull(schema.projects.archivedAt),
        ),
      ),
    snapshots.length > 0
      ? db()
          .select({
            batchId: schema.rentRollUnits.batchId,
            unitNumber: schema.rentRollUnits.unitNumber,
            inPlaceRent: schema.rentRollUnits.inPlaceRent,
            marketRent: schema.rentRollUnits.marketRent,
            leaseStart: schema.rentRollUnits.leaseStart,
            floorPlanCode: schema.rentRollUnits.floorPlanCode,
            squareFeet: schema.rentRollUnits.squareFeet,
          })
          .from(schema.rentRollUnits)
          .where(
            and(
              eq(schema.rentRollUnits.propertyId, propertyId),
              inArray(
                schema.rentRollUnits.batchId,
                snapshots.map((s) => s.batchId),
              ),
            ),
          )
      : Promise.resolve([]),
    // Realised cost. The same posted-GL rollup the project sheet calls actual,
    // so a turn's cost here matches its own page.
    db()
      .select({
        projectId: schema.glTransactions.projectId,
        total: sql<string>`coalesce(sum(${schema.glTransactions.amount}), 0)`,
      })
      .from(schema.glTransactions)
      .where(
        sql`${schema.glTransactions.propertyId} = ${propertyId} and ${schema.glTransactions.status} = 'posted' and ${schema.glTransactions.projectId} is not null`,
      )
      .groupBy(schema.glTransactions.projectId),
  ]);

  const costByProject = new Map(costRows.map((r) => [r.projectId, num(r.total)]));

  const snapshotUnits: SnapshotUnit[] = unitRows.map((r) => ({
    batchId: r.batchId,
    unitNumber: r.unitNumber,
    // numeric columns arrive as strings; null must survive as null, because
    // "no rent recorded" is what marks a vacancy to skip over.
    inPlaceRent: r.inPlaceRent == null ? null : num(r.inPlaceRent),
    marketRent: r.marketRent == null ? null : num(r.marketRent),
    leaseStart: r.leaseStart,
    floorPlanCode: r.floorPlanCode,
    squareFeet: r.squareFeet,
  }));

  const turns: TurnInput[] = turnRows.map((r) => ({
    projectId: r.projectId,
    projectName: r.projectName,
    unitNumber: r.unitNumber,
    floorplan: r.floorplan,
    tierId: r.tierId,
    tierName: r.tierName,
    targetTradeOut: r.targetTradeOut == null ? null : num(r.targetTradeOut),
    phase: r.phase,
    startDate: r.startDate,
    completeDate: r.completeDate,
    actualCost: costByProject.get(r.projectId) ?? 0,
    budgetedCost: num(r.budgetAmount),
    previousRentOverride: r.previousRent == null ? null : num(r.previousRent),
    tradeOutRentOverride: r.tradeOutRent == null ? null : num(r.tradeOutRent),
    leaseDateOverride: r.leaseDate,
  }));

  return computeTurnPerformance({ snapshots, snapshotUnits, turns });
}

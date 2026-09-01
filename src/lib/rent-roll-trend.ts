import { and, asc, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { num } from "@/lib/format";

/**
 * How the property itself has moved, snapshot to snapshot.
 *
 * Committed rent rolls are never superseded — each one stays as a dated
 * point-in-time record — so the series needed for a trend already exists the
 * moment a second roll is committed. Nothing new is stored for this.
 *
 * The figures come from the batch's OWN stored aggregates rather than being
 * recomputed from its unit rows. That is deliberate: a rent roll's occupancy
 * can be taken from the summary block the PM system prints at the foot of the
 * file, which overrides the row-by-row count (see buildStats in
 * rent-roll-import.ts). Recomputing here would quietly disagree with the batch
 * page and the snapshots list for exactly those files.
 */

export type TrendPoint = {
  batchId: number;
  asOfDate: string;
  fileName: string;
  units: number | null;
  occupied: number | null;
  /** 0–100, as stored. */
  occupancyPct: number | null;
  /** Market rent per unit, over every unit — the convention the batch page uses. */
  avgMarketRent: number | null;
  /** In-place rent per OCCUPIED unit; a vacant unit is not paying a lower rent,
   *  it is paying none, and averaging it in would read as a rent collapse. */
  avgInPlaceRent: number | null;
  /** Monthly dollars between market and in-place. */
  lossToLease: number | null;
  /** Movement against the next-older snapshot. Null on the oldest. */
  deltaOccupancyPct: number | null;
  deltaAvgInPlaceRent: number | null;
  deltaLossToLease: number | null;
};

type RawBatch = {
  batchId: number;
  asOfDate: string;
  fileName: string;
  rowCount: number | null;
  occupiedCount: number | null;
  occupancyPct: string | null;
  totalMarketRent: string | null;
  totalInPlaceRent: string | null;
  lossToLease: string | null;
};

/** Pure: raw rows oldest→newest in, display rows newest→oldest out. */
export function buildRentRollTrend(rows: RawBatch[]): TrendPoint[] {
  const ascending = rows.map((r) => {
    const units = r.rowCount;
    const occupied = r.occupiedCount;
    const totalMarket = r.totalMarketRent == null ? null : num(r.totalMarketRent);
    const totalInPlace = r.totalInPlaceRent == null ? null : num(r.totalInPlaceRent);
    return {
      batchId: r.batchId,
      asOfDate: r.asOfDate,
      fileName: r.fileName,
      units,
      occupied,
      occupancyPct: r.occupancyPct == null ? null : num(r.occupancyPct),
      avgMarketRent: totalMarket != null && units ? totalMarket / units : null,
      avgInPlaceRent: totalInPlace != null && occupied ? totalInPlace / occupied : null,
      lossToLease: r.lossToLease == null ? null : num(r.lossToLease),
    };
  });

  // Each point is compared with the one before it in time, then the whole
  // series is flipped so the most recent snapshot reads first.
  return ascending
    .map((p, i) => {
      const prev = i > 0 ? ascending[i - 1] : null;
      const diff = (a: number | null, b: number | null | undefined) =>
        a != null && b != null ? a - b : null;
      return {
        ...p,
        deltaOccupancyPct: diff(p.occupancyPct, prev?.occupancyPct),
        deltaAvgInPlaceRent: diff(p.avgInPlaceRent, prev?.avgInPlaceRent),
        deltaLossToLease: diff(p.lossToLease, prev?.lossToLease),
      };
    })
    .reverse();
}

export async function computeRentRollTrendFor(propertyId: number): Promise<TrendPoint[]> {
  const rows = await db()
    .select({
      batchId: schema.rentRollBatches.id,
      asOfDate: schema.rentRollBatches.asOfDate,
      fileName: schema.rentRollBatches.fileName,
      rowCount: schema.rentRollBatches.rowCount,
      occupiedCount: schema.rentRollBatches.occupiedCount,
      occupancyPct: schema.rentRollBatches.occupancyPct,
      totalMarketRent: schema.rentRollBatches.totalMarketRent,
      totalInPlaceRent: schema.rentRollBatches.totalInPlaceRent,
      lossToLease: schema.rentRollBatches.lossToLease,
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

  // A snapshot with no as-of date cannot be placed on a timeline at all.
  return buildRentRollTrend(
    rows.flatMap((r) => (r.asOfDate == null ? [] : [{ ...r, asOfDate: r.asOfDate }])),
  );
}

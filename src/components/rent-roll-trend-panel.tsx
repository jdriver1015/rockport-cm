import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate, money } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { TrendPoint } from "@/lib/rent-roll-trend";

/**
 * Whether a movement is good news depends on the measure: occupancy and rent
 * rising is progress, loss to lease rising is not. Passed explicitly rather
 * than inferred from the sign.
 */
function Delta({
  value,
  format,
  goodWhen = "up",
}: {
  value: number | null;
  format: (n: number) => string;
  goodWhen?: "up" | "down";
}) {
  if (value == null) return <span className="text-ink-300">—</span>;
  if (Math.abs(value) < 0.005) return <span className="text-ink-400">no change</span>;
  const good = goodWhen === "up" ? value > 0 : value < 0;
  return (
    <span className={cn("font-medium tabular-nums", good ? "text-positive" : "text-alert")}>
      {value > 0 ? "▲" : "▼"} {format(Math.abs(value))}
    </span>
  );
}

export function RentRollTrend({
  points,
  propertySlug,
}: {
  points: TrendPoint[];
  propertySlug: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base text-navy">Occupancy &amp; rent</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {points.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-muted-foreground">
            No committed rent roll yet.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>As of</TableHead>
                    <TableHead className="text-right">Units</TableHead>
                    <TableHead className="text-right">Occupancy</TableHead>
                    <TableHead className="text-right">Change</TableHead>
                    <TableHead className="text-right">Avg market</TableHead>
                    <TableHead className="text-right">Avg in-place</TableHead>
                    <TableHead className="text-right">Change</TableHead>
                    <TableHead className="text-right">Loss to lease</TableHead>
                    <TableHead className="text-right">Change</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {points.map((p) => (
                    <TableRow key={p.batchId}>
                      <TableCell>
                        <Link
                          href={`/properties/${propertySlug}/rent-rolls/${p.batchId}`}
                          className="font-medium text-navy hover:text-link hover:underline"
                        >
                          {fmtDate(p.asOfDate)}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-ink-500">
                        {p.units ?? "—"}
                        {p.occupied != null && (
                          <span className="text-ink-300"> · {p.occupied} occ</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums text-navy">
                        {p.occupancyPct == null ? "—" : `${p.occupancyPct.toFixed(1)}%`}
                      </TableCell>
                      <TableCell className="text-right text-[12px]">
                        <Delta value={p.deltaOccupancyPct} format={(n) => `${n.toFixed(1)} pt`} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-ink-500">
                        {money(p.avgMarketRent)}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums text-navy">
                        {money(p.avgInPlaceRent)}
                      </TableCell>
                      <TableCell className="text-right text-[12px]">
                        <Delta value={p.deltaAvgInPlaceRent} format={(n) => money(n)} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-ink-500">
                        {money(p.lossToLease)}
                      </TableCell>
                      <TableCell className="text-right text-[12px]">
                        <Delta
                          value={p.deltaLossToLease}
                          format={(n) => money(n)}
                          goodWhen="down"
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Each row is a committed snapshot; change is against the one before it. In-place rent
              averages occupied units only, market rent averages every unit — the same convention
              the snapshot page uses.
              {points.length === 1 && " Commit a second rent roll to see movement."}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

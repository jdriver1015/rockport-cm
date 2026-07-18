"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangleIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { KpiStrip, type KpiItem } from "@/components/ui/kpi-strip";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { money, num } from "@/lib/format";
import { commitRentRoll, parseBatch } from "@/lib/actions/rent-rolls";

export type ReviewUnit = {
  id: number;
  unitNumber: string;
  floorPlanCode: string | null;
  beds: number | null;
  baths: string | null;
  squareFeet: number | null;
  marketRent: string | null;
  inPlaceRent: string | null;
  status: string;
  residentName: string | null;
  leaseStart: string | null;
  leaseEnd: string | null;
  needsReview: boolean;
  reviewNote: string | null;
};

export type Floorplan = {
  code: string;
  count: number;
  occupied_count: number;
  occupancy_pct: number;
  avg_sqft: number;
  avg_market_rent: number;
  avg_in_place_rent: number;
};

export type RawSheet = {
  sheet_name: string;
  total_rows: number;
  rows: (string | number | null)[][];
  truncated: boolean;
};

type Mapping = {
  header_row: number;
  data_start_row: number;
  columns: Record<string, number | null | undefined>;
} | null;

// Field → color for the raw-sheet column highlighting + legend.
const FIELD_COLORS: Record<string, { bg: string; label: string }> = {
  unit_number: { bg: "bg-blue-100 dark:bg-blue-950/40", label: "Unit #" },
  floor_plan_code: { bg: "bg-violet-100 dark:bg-violet-950/40", label: "Floor Plan" },
  beds: { bg: "bg-teal-100 dark:bg-teal-950/40", label: "Beds" },
  baths: { bg: "bg-teal-100 dark:bg-teal-950/40", label: "Baths" },
  square_feet: { bg: "bg-amber-100 dark:bg-amber-950/40", label: "Sq Ft" },
  market_rent: { bg: "bg-green-100 dark:bg-green-950/40", label: "Market Rent" },
  in_place_rent: { bg: "bg-emerald-100 dark:bg-emerald-950/40", label: "In-Place Rent" },
  status: { bg: "bg-rose-100 dark:bg-rose-950/40", label: "Status" },
  resident_name: { bg: "bg-sky-100 dark:bg-sky-950/40", label: "Resident" },
  lease_start: { bg: "bg-orange-100 dark:bg-orange-950/40", label: "Lease Start" },
  lease_end: { bg: "bg-orange-100 dark:bg-orange-950/40", label: "Lease End" },
};

export function RentRollReview({
  batchId,
  committed,
  summary,
  warnings,
  confidenceScore,
  floorplans,
  units,
  rawSheet,
  mapping,
}: {
  batchId: number;
  committed: boolean;
  summary: {
    unitCount: number;
    occupancyPct: number | null;
    totalMarketRent: number;
    totalInPlaceRent: number;
    lossToLease: number;
    occupied: number;
  };
  warnings: string[];
  confidenceScore: number | null;
  floorplans: Floorplan[];
  units: ReviewUnit[];
  rawSheet: RawSheet | null;
  mapping: Mapping;
}) {
  const router = useRouter();
  const [instructions, setInstructions] = useState("");
  const [pending, startTransition] = useTransition();

  const needsReview = units
    .filter((u) => u.needsReview)
    .sort((a, b) => num(b.marketRent) - num(a.marketRent));

  const avgMarket = summary.unitCount ? summary.totalMarketRent / summary.unitCount : 0;
  const avgInPlace = summary.occupied ? summary.totalInPlaceRent / summary.occupied : 0;

  // Map raw-sheet column index → field, for color highlighting.
  const colField = new Map<number, string>();
  if (mapping?.columns) {
    for (const [field, idx] of Object.entries(mapping.columns)) {
      if (idx != null && FIELD_COLORS[field]) colField.set(idx, field);
    }
  }
  const legendFields = [...new Set([...colField.values()])];

  function handleReparse() {
    startTransition(async () => {
      const res = await parseBatch(batchId, instructions);
      if (!res.ok) toast.error(res.error);
      else {
        toast.success("Re-parsed");
        setInstructions("");
      }
      router.refresh();
    });
  }

  function handleCommit() {
    startTransition(async () => {
      const res = await commitRentRoll(batchId);
      if (!res.ok) toast.error(res.error);
      else toast.success("Rent roll committed");
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {/* KPI strip */}
      <KpiStrip
        items={
          [
            { label: "Total Units", value: summary.unitCount.toLocaleString() },
            {
              label: "Occupancy",
              value: summary.occupancyPct != null ? `${summary.occupancyPct.toFixed(1)}%` : "—",
            },
            { label: "Avg Market Rent", value: money(avgMarket) },
            { label: "Avg In-Place Rent", value: money(avgInPlace) },
            { label: "Loss to Lease / mo", value: money(summary.lossToLease) },
            {
              label: "Confidence",
              value: confidenceScore != null ? `${confidenceScore}%` : "—",
            },
          ] satisfies KpiItem[]
        }
      />

      {warnings.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
          <div className="flex items-center gap-2 text-sm font-medium text-amber-800 dark:text-amber-300">
            <AlertTriangleIcon className="size-4" /> {warnings.length} note
            {warnings.length === 1 ? "" : "s"} from the parser
          </div>
          <ul className="mt-2 list-disc space-y-1 pl-6 text-sm text-amber-900 dark:text-amber-200">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left: parsed data */}
        <div className="space-y-6">
          {needsReview.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base text-navy">
                  Needs review ({needsReview.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {needsReview.slice(0, 30).map((u) => (
                  <div key={u.id} className="rounded border border-amber-200 bg-amber-50/60 p-2 text-sm dark:border-amber-900 dark:bg-amber-950/20">
                    <span className="font-medium text-navy">Unit {u.unitNumber}</span>
                    <span className="text-muted-foreground"> — {u.reviewNote}</span>
                  </div>
                ))}
                {needsReview.length > 30 && (
                  <p className="text-xs text-muted-foreground">
                    …and {needsReview.length - 30} more
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {floorplans.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base text-navy">Floor plans</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Plan</TableHead>
                        <TableHead className="text-right">Units</TableHead>
                        <TableHead className="text-right">Occ %</TableHead>
                        <TableHead className="text-right">Avg SF</TableHead>
                        <TableHead className="text-right">Avg Market</TableHead>
                        <TableHead className="text-right">Avg In-Place</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {floorplans.map((f) => (
                        <TableRow key={f.code}>
                          <TableCell className="font-medium">{f.code}</TableCell>
                          <TableCell className="text-right tabular-nums">{f.count}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {(f.occupancy_pct * 100).toFixed(0)}%
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{f.avg_sqft || "—"}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {money(f.avg_market_rent)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {money(f.avg_in_place_rent)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base text-navy">Units ({units.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="max-h-[28rem] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Unit</TableHead>
                      <TableHead>Plan</TableHead>
                      <TableHead className="text-right">SF</TableHead>
                      <TableHead className="text-right">Market</TableHead>
                      <TableHead className="text-right">In-Place</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Resident</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {units.map((u) => (
                      <TableRow key={u.id} className={u.needsReview ? "bg-amber-50/50 dark:bg-amber-950/10" : ""}>
                        <TableCell className="font-medium text-navy">{u.unitNumber}</TableCell>
                        <TableCell>{u.floorPlanCode ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{u.squareFeet ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{money(u.marketRent)}</TableCell>
                        <TableCell className="text-right tabular-nums">{money(u.inPlaceRent)}</TableCell>
                        <TableCell>
                          <Badge variant={u.status === "vacant" ? "secondary" : "positive"}>
                            {u.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-[10rem] truncate text-muted-foreground">
                          {u.residentName ?? "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right: raw sheet, color-coded */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-navy">
              Source sheet{rawSheet ? ` — ${rawSheet.sheet_name}` : ""}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {legendFields.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-2">
                {legendFields.map((f) => (
                  <span
                    key={f}
                    className={`rounded px-2 py-0.5 text-xs ${FIELD_COLORS[f]?.bg ?? ""}`}
                  >
                    {FIELD_COLORS[f]?.label ?? f}
                  </span>
                ))}
              </div>
            )}
            {rawSheet ? (
              <div className="max-h-[36rem] overflow-auto rounded border">
                <table className="w-full border-collapse text-xs">
                  <tbody>
                    {rawSheet.rows.map((row, r) => {
                      const isHeader = mapping != null && r === mapping.header_row;
                      const beforeData = mapping != null && r < mapping.data_start_row && !isHeader;
                      return (
                        <tr key={r} className={beforeData ? "opacity-50" : ""}>
                          <td className="border px-1 text-right text-muted-foreground/60 tabular-nums">
                            {r}
                          </td>
                          {row.map((cell, c) => {
                            const field = colField.get(c);
                            return (
                              <td
                                key={c}
                                className={`whitespace-nowrap border px-2 py-1 ${
                                  isHeader ? "font-semibold" : ""
                                } ${field ? FIELD_COLORS[field]?.bg : ""}`}
                              >
                                {cell == null ? "" : String(cell)}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {rawSheet.truncated && (
                  <p className="p-2 text-center text-xs text-muted-foreground">
                    Showing first {rawSheet.rows.length} of {rawSheet.total_rows} rows.
                  </p>
                )}
              </div>
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No source-sheet preview available (PDF or unavailable).
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Footer: AI correction + commit */}
      {!committed && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-navy">Corrections & commit</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              placeholder='Tell the parser what to fix, then Re-parse. e.g. "Status column uses OCC/VAC/NTC" or "Market rent is column H, not G".'
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={2}
              disabled={pending}
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button variant="outline" onClick={handleReparse} disabled={pending}>
                {pending ? "Working…" : instructions.trim() ? "Re-parse with correction" : "Re-parse"}
              </Button>
              <Button onClick={handleCommit} disabled={pending}>
                Commit snapshot
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { KpiStrip, type KpiItem } from "@/components/ui/kpi-strip";
import { Badge } from "@/components/ui/badge";
import { fmtDate, money, moneyOrZero } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { FloorplanRollup, TurnOutcome, TurnPerformance } from "@/lib/turn-performance";

/** One decimal, because a tenth of a percent of yield is a real difference. */
function pct(value: number | null, digits = 1): string {
  return value == null ? "—" : `${(value * 100).toFixed(digits)}%`;
}

function months(value: number | null): string {
  if (value == null) return "—";
  return `${Math.round(value)} mo`;
}

/** Signed money, so a miss against target reads as a miss at a glance. */
function delta(value: number | null): string {
  if (value == null) return "—";
  if (Math.abs(value) < 0.005) return "$0";
  return `${value > 0 ? "+" : "−"}${money(Math.abs(value))}`;
}

function deltaClass(value: number | null): string {
  if (value == null || Math.abs(value) < 0.005) return "text-ink-500";
  return value > 0 ? "text-positive" : "text-alert";
}

export function TurnPerformanceKpis({ perf }: { perf: TurnPerformance }) {
  const t = perf.totals;
  const items: KpiItem[] = [
    {
      label: "Avg trade-out",
      value: t.avgTradeOut == null ? "—" : `${money(t.avgTradeOut)}/mo`,
      delta:
        t.measured === 0
          ? "no turns measured yet"
          : `across ${t.measured} turn${t.measured === 1 ? "" : "s"}`,
      deltaVariant: t.measured === 0 ? "muted" : "positive",
    },
    {
      label: "Target hit rate",
      value: pct(t.hitRate, 0),
      delta: t.hitRate == null ? "no target set" : "of measured turns",
      deltaVariant: t.hitRate == null ? "muted" : t.hitRate >= 0.5 ? "positive" : "pending",
    },
    {
      label: "Yield on cost",
      value: pct(t.roi),
      delta: t.paybackMonths == null ? "—" : `${months(t.paybackMonths)} payback`,
      deltaVariant: t.roi == null ? "muted" : "positive",
    },
    {
      label: "Annual rent added",
      value: t.annualRentAdded > 0 ? money(t.annualRentAdded) : "—",
      delta: t.avgCost == null ? "—" : `${money(t.avgCost)} avg cost/unit`,
      deltaVariant: "muted",
    },
  ];
  return <KpiStrip items={items} />;
}

/**
 * Turns that are finished but not yet re-let are the figure most likely to be
 * misread — they are not failures and not zeroes, they are simply pending. Said
 * once here rather than footnoted on every average below.
 */
export function TurnPerformancePending({ perf }: { perf: TurnPerformance }) {
  const { awaitingRelet, inProgress, noBaseline } = perf.totals;
  if (awaitingRelet === 0 && noBaseline === 0) return null;
  return (
    <p className="text-[12px] text-muted-foreground">
      {awaitingRelet > 0 && (
        <>
          <span className="font-medium text-ink-600">{awaitingRelet}</span> finished turn
          {awaitingRelet === 1 ? " is" : "s are"} waiting on a new lease and {awaitingRelet === 1 ? "is" : "are"}{" "}
          excluded from these averages.
        </>
      )}
      {noBaseline > 0 && (
        <>
          {awaitingRelet > 0 ? " " : ""}
          <span className="font-medium text-ink-600">{noBaseline}</span> ha
          {noBaseline === 1 ? "s" : "ve"} no rent roll from before the work to compare against.
        </>
      )}
      {inProgress > 0 && <> {inProgress} more still in progress.</>}
    </p>
  );
}

export function TradeOutByFloorplan({ rows }: { rows: FloorplanRollup[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base text-navy">Trade-out against goal</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-muted-foreground">
            No floorplan has a completed, re-let turn yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Floorplan</TableHead>
                  <TableHead>Renovation</TableHead>
                  <TableHead className="text-right">Turns</TableHead>
                  <TableHead className="text-right">Prior rent</TableHead>
                  <TableHead className="text-right">New rent</TableHead>
                  <TableHead className="text-right">Trade-out</TableHead>
                  <TableHead className="text-right">Goal</TableHead>
                  <TableHead className="text-right">vs goal</TableHead>
                  <TableHead className="text-right">Hit</TableHead>
                  <TableHead className="text-right">Cost/unit</TableHead>
                  <TableHead className="text-right">Yield</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={`${r.floorplan ?? "?"}-${r.tierId ?? "?"}`}>
                    <TableCell className="font-medium text-navy">{r.floorplan ?? "Unmapped"}</TableCell>
                    <TableCell className="text-ink-500">{r.tierName ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums text-ink-500">
                      {r.measured}
                      {r.awaitingRelet > 0 && (
                        <span className="text-ink-300"> +{r.awaitingRelet}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-ink-500">
                      {money(r.avgPreviousRent)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-ink-500">
                      {money(r.avgNewRent)}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums text-navy">
                      {money(r.avgTradeOut)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-ink-500">
                      {money(r.targetTradeOut)}
                    </TableCell>
                    <TableCell className={cn("text-right tabular-nums font-medium", deltaClass(r.vsTarget))}>
                      {delta(r.vsTarget)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-ink-500">
                      {pct(r.hitRate, 0)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-ink-500">
                      {money(r.avgCost)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-ink-500">{pct(r.roi)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const STATUS_LABEL: Record<TurnOutcome["status"], string> = {
  measured: "Measured",
  awaiting_relet: "Awaiting lease",
  no_baseline: "No baseline",
  in_progress: "In progress",
};

export function LatestLeases({
  outcomes,
  propertySlug,
  limit = 12,
}: {
  outcomes: TurnOutcome[];
  propertySlug: string;
  limit?: number;
}) {
  // Newest lease first — the question this answers is "what have we just
  // signed", so a turn with no lease yet has no place in the list.
  const rows = outcomes
    .filter((o) => o.status === "measured" && o.leaseDate)
    .sort((a, b) => b.leaseDate!.localeCompare(a.leaseDate!))
    .slice(0, limit);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base text-navy">Latest leases</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-muted-foreground">
            No post-renovation leases have appeared on a rent roll yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Unit</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Leased</TableHead>
                  <TableHead className="text-right">Prior</TableHead>
                  <TableHead className="text-right">New</TableHead>
                  <TableHead className="text-right">Trade-out</TableHead>
                  <TableHead className="text-right">vs goal</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">Payback</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((o) => (
                  <TableRow key={o.projectId}>
                    <TableCell>
                      <Link
                        href={`/properties/${propertySlug}/projects/${o.projectId}`}
                        className="font-medium text-navy hover:text-link hover:underline"
                      >
                        {o.unitNumber}
                      </Link>
                      {o.fromOverride && (
                        <Badge variant="outline" className="ml-2 text-[10px]">
                          manual
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-ink-500">{o.floorplan ?? "—"}</TableCell>
                    <TableCell className="text-ink-500">{fmtDate(o.leaseDate)}</TableCell>
                    <TableCell className="text-right tabular-nums text-ink-500">
                      {money(o.previousRent)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-ink-500">
                      {money(o.newRent)}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums text-navy">
                      {o.tradeOut == null ? "—" : moneyOrZero(o.tradeOut)}
                    </TableCell>
                    <TableCell className={cn("text-right tabular-nums font-medium", deltaClass(o.vsTarget))}>
                      {delta(o.vsTarget)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-ink-500">
                      {o.actualCost > 0 ? money(o.actualCost) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-ink-500">
                      {months(o.paybackMonths)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              {rows.length > 0 && (
                <TableFooter>
                  <TableRow className="hover:bg-band">
                    <TableCell colSpan={5} className="font-bold text-ink-900">
                      Showing {rows.length} most recent
                    </TableCell>
                    <TableCell className="text-right font-bold tabular-nums text-ink-900">
                      {money(
                        rows.reduce((s, o) => s + (o.tradeOut ?? 0), 0) / rows.length,
                      )}
                    </TableCell>
                    <TableCell colSpan={3} />
                  </TableRow>
                </TableFooter>
              )}
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Finished turns still waiting on a lease — the pipeline behind the averages. */
export function AwaitingLease({
  outcomes,
  propertySlug,
}: {
  outcomes: TurnOutcome[];
  propertySlug: string;
}) {
  const rows = outcomes.filter((o) => o.status === "awaiting_relet");
  if (rows.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base text-navy">Finished, awaiting a lease</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Unit</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Renovation</TableHead>
                <TableHead>Completed</TableHead>
                <TableHead className="text-right">Prior rent</TableHead>
                <TableHead className="text-right">Goal</TableHead>
                <TableHead className="text-right">Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((o) => (
                <TableRow key={o.projectId}>
                  <TableCell>
                    <Link
                      href={`/properties/${propertySlug}/projects/${o.projectId}`}
                      className="font-medium text-navy hover:text-link hover:underline"
                    >
                      {o.unitNumber}
                    </Link>
                  </TableCell>
                  <TableCell className="text-ink-500">{o.floorplan ?? "—"}</TableCell>
                  <TableCell className="text-ink-500">{o.tierName ?? "—"}</TableCell>
                  <TableCell className="text-ink-500">{fmtDate(o.completeDate)}</TableCell>
                  <TableCell className="text-right tabular-nums text-ink-500">
                    {money(o.previousRent)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-ink-500">
                    {money(o.targetTradeOut)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-ink-500">
                    {o.actualCost > 0 ? money(o.actualCost) : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

const STATUS_ORDER: TurnOutcome["status"][] = [
  "measured",
  "awaiting_relet",
  "no_baseline",
  "in_progress",
];

/** Small legend so the four states are not folklore. */
export function OutcomeLegend({ perf }: { perf: TurnPerformance }) {
  const counts: Record<TurnOutcome["status"], number> = {
    measured: perf.totals.measured,
    awaiting_relet: perf.totals.awaitingRelet,
    no_baseline: perf.totals.noBaseline,
    in_progress: perf.totals.inProgress,
  };
  const present = STATUS_ORDER.filter((s) => counts[s] > 0);
  if (present.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {present.map((s) => (
        <Badge key={s} variant="outline" className="text-[11px] font-normal">
          {STATUS_LABEL[s]} · {counts[s]}
        </Badge>
      ))}
    </div>
  );
}

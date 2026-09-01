import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { PropertyHeader } from "@/components/property-header";
import { PropertyNav } from "@/components/property-nav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { LineChart, BarChart, type Series } from "@/components/exec-charts";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// MOCKUP. Every figure below is invented.
//
// The point of this page is to decide what an executive should be looking at,
// before wiring any of it up — so the numbers are chosen to show each chart
// doing its job (a programme running behind plan, cost drifting up, cycle time
// stretching) rather than to describe the real property.
//
// What the real version would read from, once it exists:
//   spend curve   posted GL by txnDate (actual), awarded bids (committed),
//                 project budgets spread across their scheduled phases (plan)
//   velocity      completed unit turns per month, from projectMilestones
//   cost / unit   posted GL per completed turn, grouped by renovation type
//   cycle time    complete date minus start date per turn, by type
//   exceptions    budget variance, target-slip (already computed in
//                 src/lib/target-slip.ts) and uncommitted scope
//
// Aston currently has no posted GL and no completed turns, so three of those
// five have nothing to plot today. That gap is the reason this is a mockup.
// ---------------------------------------------------------------------------

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
/** Show every other month so the axis does not crowd. */
const X_LABELS = MONTHS.map((m, i) => (i % 2 === 0 ? `${m}${i === 0 ? " 26" : i === 12 ? " 27" : ""}` : ""));
const TODAY_X = 8; // September 2026

/** Cumulative $000s. Plan runs the full 24 months; actual and committed stop at today. */
const PLAN = [120, 310, 580, 940, 1380, 1890, 2470, 3100, 3760, 4440, 5120, 5780, 6390, 6940, 7420, 7810, 8080, 8230, 8280, 8290, 8290, 8290, 8290, 8290];
const COMMITTED = [250, 620, 1150, 1780, 2400, 3050, 3720, 4310, 4820];
const ACTUAL = [40, 150, 340, 610, 940, 1290, 1660, 1980, 2240];

const pts = (ys: number[]) => ys.map((y, x) => ({ x, y }));

const SPEND: Series[] = [
  { key: "plan", label: "Plan", color: "var(--color-ink-300)", points: pts(PLAN) },
  { key: "committed", label: "Committed", color: "var(--color-gold)", points: pts(COMMITTED) },
  { key: "actual", label: "Actual", color: "var(--color-navy)", points: pts(ACTUAL), fill: true },
];

/** Completed turns per month, Jan–Sep 26. */
const COMPLETIONS = [1, 2, 4, 5, 7, 9, 11, 12, 12];
const REQUIRED_RATE = 22;

const COST_MONTHS = ["Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep"];
const COST_SERIES: Series[] = [
  { key: "el", label: "Enhanced Light", color: "var(--color-positive)", points: pts([6410, 6480, 6520, 6610, 6700, 6840, 6910]) },
  { key: "en", label: "Enhanced", color: "var(--color-navy)", points: pts([6050, 6110, 6180, 6240, 6330, 6410, 6480]) },
  { key: "sg", label: "Signature", color: "var(--color-gold)", points: pts([17600, 17850, 18100, 18400, 18720, 19010, 19240]) },
];
/** Underwritten per-unit cost for each type — the line the trend is drifting off. */
const COST_TARGETS: Series[] = [
  { key: "el-t", label: "Enhanced Light (UW)", color: "var(--color-positive)", dashed: true, points: pts(Array(7).fill(6720)) },
  { key: "en-t", label: "Enhanced (UW)", color: "var(--color-navy)", dashed: true, points: pts(Array(7).fill(6176)) },
  { key: "sg-t", label: "Signature (UW)", color: "var(--color-gold)", dashed: true, points: pts(Array(7).fill(17983)) },
];

const CYCLE_SERIES: Series[] = [
  { key: "el", label: "Enhanced Light", color: "var(--color-positive)", points: pts([16, 17, 17, 18, 19, 19, 20]) },
  { key: "en", label: "Enhanced", color: "var(--color-navy)", points: pts([21, 21, 22, 23, 23, 24, 25]) },
  { key: "sg", label: "Signature", color: "var(--color-gold)", points: pts([34, 35, 36, 38, 39, 40, 41]) },
];

type Verdict = { label: string; value: string; sub: string; tone: "good" | "warn" | "bad" };
const VERDICTS: Verdict[] = [
  { label: "Projected completion", value: "Dec 2028", sub: "12 months past plan", tone: "bad" },
  { label: "Spend vs progress", value: "27% / 16%", sub: "spend ahead of units turned", tone: "warn" },
  { label: "Cost per unit", value: "+3.2%", sub: "vs underwriting, drifting up", tone: "warn" },
  { label: "Trade-out", value: "+$312/mo", sub: "$37 above underwriting", tone: "good" },
];

const TONE: Record<Verdict["tone"], string> = {
  good: "text-positive",
  warn: "text-pending",
  bad: "text-alert",
};

const EXCEPTIONS = [
  { item: "Tech Package", why: "Blocked — vendor selected, no pricing in 3 weeks", impact: "$352,800 uncommitted", tone: "bad" },
  { item: "Façade Replacement", why: "Bid $370k against $200k budget", impact: "+$170,000 over", tone: "bad" },
  { item: "Signature turns", why: "Cycle time 41 days vs 34 at start", impact: "+7 days per unit", tone: "warn" },
  { item: "Outdoor Kitchen / Pergola", why: "Re-pricing with a second vendor", impact: "$100,000 at risk", tone: "warn" },
  { item: "Fitness Equipment", why: "Budgeted, not yet scoped", impact: "$10,000 uncommitted", tone: "warn" },
];

export default async function ExecutivePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const property = await db().query.properties.findFirst({ where: eq(schema.properties.slug, slug) });
  if (!property) notFound();

  return (
    <div className="space-y-6">
      <PropertyHeader property={property} />
      <PropertyNav slug={property.slug} />

      <div className="flex items-center gap-2 rounded-card border border-pending/30 bg-pending-bg px-3 py-2">
        <Badge variant="outline" className="border-pending/40 text-[10px] text-pending">
          Mockup
        </Badge>
        <p className="text-[12px] text-ink-600">
          Every figure on this page is invented, to decide what belongs here before wiring it up.
        </p>
      </div>

      {/* The five-second read. Everything below this row is the explanation. */}
      <div className="grid gap-3.5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
        {VERDICTS.map((v) => (
          <div key={v.label} className="rounded-card border border-border bg-card px-5 py-[18px]">
            <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-text-faint">{v.label}</div>
            <div className={cn("mt-2 text-[22px] font-bold tracking-tight tabular-nums", TONE[v.tone])}>{v.value}</div>
            <div className="mt-1 text-xs font-medium text-muted-foreground">{v.sub}</div>
          </div>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base text-navy">Spend against plan</CardTitle>
          <p className="text-[12px] text-muted-foreground">
            Cumulative capital. The plan runs to completion; actual and committed stop at today, so the
            vertical gap is how far behind the programme is running.
          </p>
        </CardHeader>
        <CardContent>
          <LineChart
            series={SPEND}
            xLabels={X_LABELS}
            markerX={TODAY_X}
            markerLabel="Today"
            yFormat={(v) => `$${(v / 1000).toFixed(1)}M`}
            height={280}
          />
          <p className="mt-2 pl-[64px] text-[12px] text-ink-600">
            <span className="font-semibold text-alert">$1.52M behind plan</span> at today, with{" "}
            <span className="font-semibold">$4.82M committed</span> — $3.47M of the budget is still
            uncommitted and therefore still controllable.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-navy">Turn velocity</CardTitle>
            <p className="text-[12px] text-muted-foreground">
              Units completed each month against the rate needed to finish on time.
            </p>
          </CardHeader>
          <CardContent>
            <BarChart
              bars={COMPLETIONS}
              xLabels={MONTHS.slice(0, 9)}
              yFormat={(v) => String(Math.round(v))}
              targetLine={REQUIRED_RATE}
              targetLabel={`${REQUIRED_RATE}/mo needed`}
            />
            <p className="mt-2 pl-[64px] text-[12px] text-ink-600">
              63 of 392 turned. At the current{" "}
              <span className="font-semibold">12/month</span> the last unit lands{" "}
              <span className="font-semibold text-alert">Dec 2028</span>; the plan says Dec 2027.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base text-navy">Cost per unit</CardTitle>
            <p className="text-[12px] text-muted-foreground">
              Trailing average of realised cost by renovation type, against underwriting (dashed).
            </p>
          </CardHeader>
          <CardContent>
            <LineChart
              series={[...COST_SERIES, ...COST_TARGETS]}
              xLabels={COST_MONTHS}
              yFormat={(v) => `$${(v / 1000).toFixed(0)}k`}
              height={240}
            />
            <p className="mt-2 pl-[64px] text-[12px] text-ink-600">
              Every type is drifting up. <span className="font-semibold">Signature</span> is now{" "}
              <span className="font-semibold text-alert">$1,257 over</span> underwriting per unit — on 91
              planned units that is $114k.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base text-navy">Cycle time</CardTitle>
          <p className="text-[12px] text-muted-foreground">
            Trailing average days from start to sign-off, by renovation type. Rising cycle time is what
            turns a pace problem into a completion-date problem.
          </p>
        </CardHeader>
        <CardContent>
          <LineChart
            series={CYCLE_SERIES}
            xLabels={COST_MONTHS}
            yFormat={(v) => `${Math.round(v)}d`}
            height={230}
          />
          <p className="mt-2 pl-[64px] text-[12px] text-ink-600">
            Signature turns have stretched from 34 to 41 days since March. Holding the other two flat and
            recovering Signature alone would return roughly{" "}
            <span className="font-semibold">1.5 turns a month</span> of capacity.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base text-navy">Needs a decision</CardTitle>
          <p className="text-[12px] text-muted-foreground">
            The few things actually worth an executive&apos;s attention, not every open item.
          </p>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Item</TableHead>
                <TableHead>Why it is here</TableHead>
                <TableHead className="text-right">Impact</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {EXCEPTIONS.map((e) => (
                <TableRow key={e.item}>
                  <TableCell className="font-medium text-navy">{e.item}</TableCell>
                  <TableCell className="text-ink-500">{e.why}</TableCell>
                  <TableCell
                    className={cn(
                      "text-right font-medium tabular-nums",
                      e.tone === "bad" ? "text-alert" : "text-pending",
                    )}
                  >
                    {e.impact}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

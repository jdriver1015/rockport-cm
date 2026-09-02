import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { PropertyHeader } from "@/components/property-header";
import { PropertyNav } from "@/components/property-nav";
import { Card, CardContent } from "@/components/ui/card";
import { ExecCapitalCharts } from "@/components/exec-capital-charts";
import { readExecCapital } from "@/lib/exec-capital-data";
import { todayInBusinessZone, toIsoDate } from "@/lib/schedule-defaults";
import type { ScheduleStatus } from "@/lib/target-slip";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const money = (v: number) => `$${Math.round(v).toLocaleString()}`;

const SCHEDULE: Record<ScheduleStatus, { label: string; tone: string }> = {
  on_time: { label: "On track", tone: "text-positive" },
  slipping: { label: "Slipping", tone: "text-pending" },
  late: { label: "Late", tone: "text-alert" },
  unknown: { label: "No dates", tone: "text-muted-foreground" },
};

export default async function ExecutivePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const property = await db().query.properties.findFirst({ where: eq(schema.properties.slug, slug) });
  if (!property) notFound();

  const today = toIsoDate(todayInBusinessZone());
  const cap = await readExecCapital(property.id, today);

  const scopedPct = cap.budgetTotal > 0 ? Math.round((cap.projectTotal / cap.budgetTotal) * 100) : 0;
  const sched = SCHEDULE[cap.schedule.status];

  // Four figures, all read from real data. Deliberately no spend or trade-out
  // tile: this property has no posted GL, and a $0 spend tile reads as "under
  // budget" when it really means "unreported".
  const cards: { label: string; value: string; sub: string; tone?: string }[] = [
    {
      label: "Total budget",
      value: money(cap.budgetTotal),
      sub: `${cap.projectCount} project${cap.projectCount === 1 ? "" : "s"}`,
    },
    {
      label: "Scoped into projects",
      value: money(cap.projectTotal),
      sub: `${scopedPct}% of budget · ${money(cap.budgetTotal - cap.projectTotal)} unscoped`,
      tone: scopedPct >= 90 ? "text-positive" : "text-pending",
    },
    {
      label: "In process",
      value: money(cap.inProcessTotal),
      sub: `${cap.inProcessCount} project${cap.inProcessCount === 1 ? "" : "s"} under way`,
    },
    {
      label: "Schedule",
      value: sched.label,
      sub: cap.schedule.late > 0 ? `${cap.schedule.late} project(s) late` : "against planned dates",
      tone: sched.tone,
    },
  ];

  return (
    <div className="space-y-6">
      <PropertyHeader property={property} />
      <PropertyNav slug={property.slug} />

      <div className="grid gap-3.5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))" }}>
        {cards.map((c) => (
          <div key={c.label} className="rounded-card border border-border bg-card px-5 py-[18px]">
            <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-text-faint">
              {c.label}
            </div>
            <div className={cn("mt-2 text-[22px] font-bold tracking-tight tabular-nums", c.tone ?? "text-navy")}>
              {c.value}
            </div>
            <div className="mt-1 text-xs font-medium text-muted-foreground">{c.sub}</div>
          </div>
        ))}
      </div>

      <Card>
        <CardContent className="pt-5">
          <ExecCapitalCharts byPhase={cap.byPhase} curve={cap.curve} />
        </CardContent>
      </Card>
    </div>
  );
}

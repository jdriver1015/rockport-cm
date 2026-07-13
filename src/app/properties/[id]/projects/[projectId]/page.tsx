import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StagePipeline } from "@/components/stage-pipeline";
import { AdvanceStageButton } from "@/components/advance-stage-button";
import { fmtDate, money, num } from "@/lib/format";
import { nextStage, stageLabel } from "@/lib/stages";

export const dynamic = "force-dynamic";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string; projectId: string }>;
}) {
  const { id, projectId: pid } = await params;
  const propertyId = Number(id);
  const projectId = Number(pid);
  if (!Number.isInteger(propertyId) || !Number.isInteger(projectId)) notFound();

  const row = await db()
    .select({
      project: schema.projects,
      costCode: schema.costCodes,
      unit: schema.units,
      vendor: schema.vendors,
    })
    .from(schema.projects)
    .leftJoin(schema.costCodes, eq(schema.projects.costCodeId, schema.costCodes.id))
    .leftJoin(schema.units, eq(schema.projects.unitId, schema.units.id))
    .leftJoin(schema.vendors, eq(schema.projects.vendorId, schema.vendors.id))
    .where(eq(schema.projects.id, projectId))
    .limit(1);

  const data = row[0];
  if (!data || data.project.propertyId !== propertyId) notFound();
  const { project, costCode, unit, vendor } = data;

  const [jtd] = await db()
    .select({ total: sql<string>`coalesce(sum(${schema.glTransactions.amount}), 0)` })
    .from(schema.glTransactions)
    .where(
      sql`${schema.glTransactions.projectId} = ${projectId} and ${schema.glTransactions.status} = 'posted'`,
    );

  const stageHistory = await db()
    .select()
    .from(schema.projectStageEvents)
    .where(eq(schema.projectStageEvents.projectId, projectId))
    .orderBy(desc(schema.projectStageEvents.createdAt))
    .limit(10);

  const next = nextStage(project.stage);
  const jtdN = parseFloat(jtd.total);
  const budget = num(project.budgetAmount);

  const tradeOut =
    project.previousRent && project.tradeOutRent
      ? num(project.tradeOutRent) - num(project.previousRent)
      : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm">
            <Link href={`/properties/${propertyId}/projects`} className="text-gold-link hover:underline">
              ← All projects
            </Link>
          </p>
          <h1 className="mt-1 font-serif text-2xl font-semibold text-navy">{project.name}</h1>
          <p className="text-sm text-muted-foreground">
            {costCode ? (
              <>
                UW line item:{" "}
                <span className="font-mono text-xs">
                  {costCode.code} · {costCode.name}
                </span>
              </>
            ) : (
              "Interior unit turn — spend across 4000-series codes"
            )}
            {unit ? ` · Unit ${unit.unitNumber}` : ""}
            {vendor ? ` · ${vendor.name}` : ""}
          </p>
        </div>
        {next && (
          <AdvanceStageButton
            projectId={project.id}
            toStage={next.key}
            label={next.label}
            gate={next.gate}
          />
        )}
      </div>

      <StagePipeline current={project.stage} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Project Budget", value: money(budget) },
          { label: "Committed", value: money(project.committedCost) },
          { label: "JTD Actual", value: money(jtdN) },
          { label: "Remaining vs Budget", value: money(budget - jtdN) },
        ].map((kpi) => (
          <Card key={kpi.label}>
            <CardHeader className="pb-1">
              <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {kpi.label}
              </CardTitle>
            </CardHeader>
            <CardContent className="font-serif text-2xl font-semibold tabular-nums text-navy">
              {kpi.value}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-navy">Details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Start date</dt>
              <dd>{fmtDate(project.startDate)}</dd>
              <dt className="text-muted-foreground">Complete date</dt>
              <dd>{fmtDate(project.completeDate)}</dd>
              {project.kind === "unit" && (
                <>
                  <dt className="text-muted-foreground">Previous rent</dt>
                  <dd className="tabular-nums">{money(project.previousRent)}</dd>
                  <dt className="text-muted-foreground">Trade-out rent</dt>
                  <dd className="tabular-nums">{money(project.tradeOutRent)}</dd>
                  <dt className="text-muted-foreground">Trade-out $</dt>
                  <dd className="tabular-nums">{tradeOut !== null ? money(tradeOut) : "—"}</dd>
                  <dt className="text-muted-foreground">Lease date</dt>
                  <dd>{fmtDate(project.leaseDate)}</dd>
                </>
              )}
              {project.notes && (
                <>
                  <dt className="text-muted-foreground">Notes</dt>
                  <dd>{project.notes}</dd>
                </>
              )}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base text-navy">Stage history</CardTitle>
          </CardHeader>
          <CardContent>
            {stageHistory.length === 0 ? (
              <p className="text-sm text-muted-foreground">No stage changes yet.</p>
            ) : (
              <ul className="space-y-2">
                {stageHistory.map((e) => (
                  <li key={e.id} className="flex items-center gap-3 text-sm">
                    <span className="w-28 shrink-0 text-muted-foreground">
                      {fmtDate(e.createdAt)}
                    </span>
                    <Badge variant="secondary">
                      {e.fromStage ? `${stageLabel(e.fromStage)} → ` : ""}
                      {stageLabel(e.toStage)}
                    </Badge>
                    {e.note && <span className="text-muted-foreground">{e.note}</span>}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

import { notFound } from "next/navigation";
import { desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProjectNav } from "@/components/project-nav";
import { StagePipeline } from "@/components/stage-pipeline";
import { setProjectStage } from "@/lib/actions/projects";
import { fmtDate, money } from "@/lib/format";
import { nextStage, stageLabel } from "@/lib/stages";

export const dynamic = "force-dynamic";

export default async function ProjectOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const projectId = Number(id);
  if (!Number.isInteger(projectId)) notFound();

  const project = await db().query.projects.findFirst({
    where: eq(schema.projects.id, projectId),
  });
  if (!project) notFound();

  const [budget] = await db()
    .select({ total: sql<string>`coalesce(sum(${schema.budgetLines.uwAmount}), 0)` })
    .from(schema.budgetLines)
    .where(eq(schema.budgetLines.projectId, projectId));

  const [committed] = await db()
    .select({ total: sql<string>`coalesce(sum(${schema.scopes.committedCost}), 0)` })
    .from(schema.scopes)
    .where(eq(schema.scopes.projectId, projectId));

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
    .limit(8);

  const uw = parseFloat(budget.total);
  const jtdN = parseFloat(jtd.total);
  const next = nextStage(project.stage);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-[#1b355d]">{project.name}</h1>
          <p className="text-sm text-muted-foreground">
            {[project.entity, [project.city, project.state].filter(Boolean).join(", ")]
              .filter(Boolean)
              .join(" · ") || "—"}
            {project.unitCount ? ` · ${project.unitCount} units` : ""}
          </p>
        </div>
        {next && (
          <form action={setProjectStage}>
            <input type="hidden" name="projectId" value={project.id} />
            <input type="hidden" name="toStage" value={next.key} />
            <Button type="submit" title={`Gate: ${next.gate}`}>
              Advance to {next.label}
            </Button>
          </form>
        )}
      </div>

      <StagePipeline current={project.stage} />

      <ProjectNav projectId={project.id} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              UW Budget
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums text-[#1b355d]">
            {money(uw)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Committed
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums text-[#1b355d]">
            {money(committed.total)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              JTD Actual
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums text-[#1b355d]">
            {money(jtdN)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Remaining vs UW
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums text-[#1b355d]">
            {money(uw - jtdN)}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base text-[#1b355d]">Stage history</CardTitle>
        </CardHeader>
        <CardContent>
          {stageHistory.length === 0 ? (
            <p className="text-sm text-muted-foreground">No stage changes yet.</p>
          ) : (
            <ul className="space-y-2">
              {stageHistory.map((e) => (
                <li key={e.id} className="flex items-center gap-3 text-sm">
                  <span className="w-32 shrink-0 text-muted-foreground">
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
  );
}

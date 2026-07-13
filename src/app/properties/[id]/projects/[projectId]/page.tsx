import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadgeDropdown } from "@/components/status-badge-dropdown";
import { ProjectDetailTabs } from "@/components/project-detail-tabs";
import { ScopeTable, type ScopeRow } from "@/components/scope-table";
import { DocumentManager, type DocumentRow } from "@/components/document-manager";
import { fmtDate, money, num } from "@/lib/format";
import { stageLabel } from "@/lib/stages";

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

  const scope = await db()
    .select()
    .from(schema.scopeItems)
    .where(eq(schema.scopeItems.projectId, projectId))
    .orderBy(asc(schema.scopeItems.sortOrder), asc(schema.scopeItems.id));

  const auditLog = await db()
    .select()
    .from(schema.projectStageEvents)
    .where(eq(schema.projectStageEvents.projectId, projectId))
    .orderBy(desc(schema.projectStageEvents.createdAt))
    .limit(100);

  const docs = await db()
    .select()
    .from(schema.attachments)
    .where(
      and(eq(schema.attachments.projectId, projectId), eq(schema.attachments.kind, "document")),
    )
    .orderBy(desc(schema.attachments.createdAt));

  const documentRows: DocumentRow[] = docs.map((d) => ({
    id: d.id,
    name: d.caption ?? d.storagePath.split("/").pop() ?? "document",
    caption: d.caption,
    createdAt: d.createdAt,
  }));

  const jtdN = parseFloat(jtd.total);
  const budget = num(project.budgetAmount);

  const tradeOut =
    project.previousRent && project.tradeOutRent
      ? num(project.tradeOutRent) - num(project.previousRent)
      : null;

  const scopeRows: ScopeRow[] = scope.map((s) => ({
    id: s.id,
    item: s.item,
    quantity: s.quantity,
    unitCost: s.unitCost,
    vendor: s.vendor,
    status: s.status,
  }));

  const overview = (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Project Budget", value: money(budget) },
          { label: "Committed", value: money(project.committedCost) },
          { label: "JTD Actual", value: money(jtdN) },
          { label: "Remaining vs Budget", value: money(budget - jtdN) },
        ].map((kpi) => (
          <Card key={kpi.label} className="bg-paper">
            <CardHeader className="pb-1">
              <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {kpi.label}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold tabular-nums text-navy">
              {kpi.value}
            </CardContent>
          </Card>
        ))}
      </div>

      <ScopeTable propertyId={propertyId} projectId={projectId} items={scopeRows} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base text-navy">Details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:max-w-md">
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
    </>
  );

  const log = (
    <Card>
      <CardHeader>
        <CardTitle className="text-base text-navy">Audit log</CardTitle>
      </CardHeader>
      <CardContent>
        {auditLog.length === 0 ? (
          <p className="text-sm text-muted-foreground">No activity yet.</p>
        ) : (
          <ul className="space-y-2">
            {auditLog.map((e) => (
              <li key={e.id} className="flex items-center gap-3 text-sm">
                <span className="w-32 shrink-0 text-muted-foreground">{fmtDate(e.createdAt)}</span>
                <Badge variant="secondary" className="border border-border">
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
  );

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm">
          <Link href={`/properties/${propertyId}`} className="text-gold-link hover:underline">
            ← All projects
          </Link>
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="font-serif text-2xl font-semibold text-navy">{project.name}</h1>
          <StatusBadgeDropdown projectId={project.id} stage={project.stage} />
        </div>
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

      <ProjectDetailTabs
        overview={overview}
        documents={
          <DocumentManager propertyId={propertyId} projectId={projectId} documents={documentRows} />
        }
        log={log}
      />
    </div>
  );
}

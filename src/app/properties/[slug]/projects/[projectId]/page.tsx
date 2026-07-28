import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArchiveProjectDialog } from "@/components/archive-project-dialog";
import { RestoreProjectButton } from "@/components/restore-project-button";
import { StatusBadgeDropdown } from "@/components/status-badge-dropdown";
import { ProjectDetailTabs } from "@/components/project-detail-tabs";
import { ProjectEditDialog } from "@/components/project-edit-dialog";
import { ScopeTable, type ScopeRow } from "@/components/scope-table";
import { PricedScopeTable, type PricedScopeRow } from "@/components/priced-scope-table";
import { type LineTxn } from "@/components/line-transactions-dialog";
import { AdvancePhaseDialog } from "@/components/advance-phase-dialog";
import { ProjectCostTable, type CostRow } from "@/components/project-cost-table";
import { OpenItemsStrip, type OpenItemsSummary } from "@/components/open-items-strip";
import type { PricingMethod } from "@/lib/pricing";
import { DocumentManager, type DocumentRow } from "@/components/document-manager";
import { AddAuditDialog } from "@/components/add-audit-dialog";
import { SiteAuditsTable } from "@/components/site-audits-table";
import { fmtDate, num } from "@/lib/format";
import { nextPhase, phaseLabel } from "@/lib/stages";
import { evaluateGates } from "@/lib/phase-gates";
import { createClient } from "@/lib/supabase/server";
import { parseProjectId, projectSlug } from "@/lib/slug";

export const dynamic = "force-dynamic";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ slug: string; projectId: string }>;
}) {
  const { slug, projectId: pid } = await params;
  const projectId = parseProjectId(pid);
  if (!Number.isInteger(projectId)) notFound();

  const property = await db().query.properties.findFirst({ where: eq(schema.properties.slug, slug) });
  if (!property) notFound();
  const propertyId = property.id;

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

  // Canonicalize: legacy bare-id links and stale name suffixes (after a
  // rename) both redirect to the current id-prefixed slug.
  const canonicalProjectSlug = projectSlug(project);
  if (pid !== canonicalProjectSlug) redirect(`/properties/${slug}/projects/${canonicalProjectSlug}`);

  const [
    scope,
    auditLog,
    docs,
    projectAudits,
    otherProjects,
    findingCounts,
    milestones,
    glRows,
    openFindings,
  ] = await Promise.all([
    db()
      .select()
      .from(schema.scopeItems)
      .where(
        and(eq(schema.scopeItems.projectId, projectId), isNull(schema.scopeItems.archivedAt)),
      )
      .orderBy(asc(schema.scopeItems.sortOrder), asc(schema.scopeItems.id)),
    db()
      .select()
      .from(schema.projectStageEvents)
      .where(eq(schema.projectStageEvents.projectId, projectId))
      .orderBy(desc(schema.projectStageEvents.createdAt))
      .limit(100),
    db()
      .select()
      .from(schema.attachments)
      .where(
        and(
          eq(schema.attachments.projectId, projectId),
          eq(schema.attachments.kind, "document"),
          isNull(schema.attachments.archivedAt),
        ),
      )
      .orderBy(desc(schema.attachments.createdAt)),
    db()
      .select()
      .from(schema.siteAudits)
      .where(and(eq(schema.siteAudits.projectId, projectId), isNull(schema.siteAudits.archivedAt)))
      .orderBy(desc(schema.siteAudits.auditDate), desc(schema.siteAudits.id)),
    db()
      .select({ id: schema.projects.id, name: schema.projects.name })
      .from(schema.projects)
      .where(and(eq(schema.projects.propertyId, propertyId), isNull(schema.projects.archivedAt)))
      .orderBy(asc(schema.projects.name)),
    db()
      .select({ auditId: schema.auditFindings.auditId, count: sql<number>`count(*)::int` })
      .from(schema.auditFindings)
      .where(isNull(schema.auditFindings.archivedAt))
      .groupBy(schema.auditFindings.auditId),
    // Milestones for this project
    db()
      .select()
      .from(schema.projectMilestones)
      .where(
        and(
          eq(schema.projectMilestones.projectId, projectId),
          isNull(schema.projectMilestones.archivedAt),
        ),
      )
      .orderBy(asc(schema.projectMilestones.sortOrder), asc(schema.projectMilestones.id)),
    // Posted GL transactions for cost detail
    db()
      .select({
        id: schema.glTransactions.id,
        txnDate: schema.glTransactions.txnDate,
        vendorRaw: schema.glTransactions.vendorRaw,
        vendorName: schema.vendors.name,
        description: schema.glTransactions.description,
        invoiceNo: schema.glTransactions.invoiceNo,
        costCodeId: schema.glTransactions.costCodeId,
        costCodeName: schema.costCodes.name,
        amount: schema.glTransactions.amount,
      })
      .from(schema.glTransactions)
      .leftJoin(schema.vendors, eq(schema.glTransactions.vendorId, schema.vendors.id))
      .leftJoin(schema.costCodes, eq(schema.glTransactions.costCodeId, schema.costCodes.id))
      .where(
        and(
          eq(schema.glTransactions.projectId, projectId),
          eq(schema.glTransactions.status, "posted"),
        ),
      )
      .orderBy(asc(schema.glTransactions.txnDate), asc(schema.glTransactions.id)),
    // Open audit findings for this project (via siteAudits)
    db()
      .select({
        id: schema.auditFindings.id,
        dueDate: schema.auditFindings.dueDate,
      })
      .from(schema.auditFindings)
      .innerJoin(schema.siteAudits, eq(schema.auditFindings.auditId, schema.siteAudits.id))
      .where(
        and(
          eq(schema.siteAudits.projectId, projectId),
          isNull(schema.siteAudits.archivedAt),
          isNull(schema.auditFindings.archivedAt),
          eq(schema.auditFindings.status, "open"),
        ),
      ),
  ]);

  const findingsByAudit = new Map(findingCounts.map((r) => [r.auditId, r.count]));

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const profile = user
    ? await db().query.profiles.findFirst({ where: eq(schema.profiles.id, user.id) })
    : null;

  // Totals still needed by phase-gate evaluation below (KPI strip removed).
  const budgetAmt = num(project.budgetAmount);
  const committedAmt = num(project.committedCost);
  const spentAmt = glRows.reduce((s, r) => s + num(r.amount), 0);

  // --- Open items tri-split ---
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const sevenDaysOut = new Date(today);
  sevenDaysOut.setDate(sevenDaysOut.getDate() + 7);

  const openItemsSummary: OpenItemsSummary = { overdue: 0, dueSoon: 0, later: 0 };
  for (const f of openFindings) {
    if (!f.dueDate) {
      openItemsSummary.later++;
      continue;
    }
    const due = new Date(f.dueDate + "T00:00:00");
    if (due < today) openItemsSummary.overdue++;
    else if (due <= sevenDaysOut) openItemsSummary.dueSoon++;
    else openItemsSummary.later++;
  }

  // --- Phase gate evaluation ---
  const next = nextPhase(project.phase);
  const startMilestone = milestones.find((m) => m.phase === "in_process");
  const gateResult = next
    ? evaluateGates(project.phase as Parameters<typeof evaluateGates>[0], next.key as Parameters<typeof evaluateGates>[1], {
        scopeLineCount: scope.length,
        budgetAmount: budgetAmt,
        committedCost: committedAmt,
        vendorAssigned: !!project.vendorId,
        scopeNotStartedCount: scope.filter((s) => s.status === "not_started").length,
        scopeCompleteCount: scope.filter((s) => s.status === "complete").length,
        scopeTotalCount: scope.length,
        hasStartMilestoneActual: !!startMilestone?.actualDate,
        openFindingCount: openFindings.length,
        postedGlTotal: spentAmt,
      })
    : null;

  // --- Cost table rows ---
  const costRows: CostRow[] = glRows.map((r) => ({
    id: r.id,
    txnDate: r.txnDate,
    vendor: r.vendorName ?? r.vendorRaw ?? "—",
    description: r.description,
    invoiceNo: r.invoiceNo,
    costCodeName: r.costCodeName,
    amount: r.amount,
  }));

  const documentRows: DocumentRow[] = docs.map((d) => ({
    id: d.id,
    name: d.caption ?? d.storagePath.split("/").pop() ?? "document",
    caption: d.caption,
    createdAt: d.createdAt,
  }));

  const scopeRows: ScopeRow[] = scope.map((s) => ({
    id: s.id,
    item: s.item,
    materialQuality: s.materialQuality,
    productLink: s.productLink,
    category: s.category,
    status: s.status,
  }));

  const scopeCodeIds = [...new Set(scope.map((s) => s.costCodeId).filter((c): c is number => !!c))];
  const scopeCodes = scopeCodeIds.length
    ? await db()
        .select({ id: schema.costCodes.id, name: schema.costCodes.name })
        .from(schema.costCodes)
        .where(inArray(schema.costCodes.id, scopeCodeIds))
    : [];
  const codeById = new Map(scopeCodes.map((c) => [c.id, c.name]));
  const isPriced = project.kind === "unit" && scope.some((s) => s.pricingMethod != null);
  const pricedScopeRows: PricedScopeRow[] = scope.map((s) => ({
    id: s.id,
    item: s.item,
    materialQuality: s.materialQuality,
    category: s.category,
    status: s.status,
    pricingMethod: s.pricingMethod as PricingMethod | null,
    unitPrice: s.unitPrice,
    quantity: s.quantity,
    costCode: s.costCodeId != null ? codeById.get(s.costCodeId) ?? null : null,
    costCodeId: s.costCodeId,
  }));

  // Group posted GL transactions by cost code so each scope line's Actual
  // column can drill down to the underlying invoices for its code.
  const transactionsByCode: Record<number, LineTxn[]> = {};
  for (const r of glRows) {
    if (r.costCodeId == null) continue;
    (transactionsByCode[r.costCodeId] ??= []).push({
      id: r.id,
      txnDate: r.txnDate,
      vendor: r.vendorName ?? r.vendorRaw ?? "—",
      description: r.description,
      invoiceNo: r.invoiceNo,
      amount: r.amount,
    });
  }

  const overview = (
    <>
      {gateResult && next && !project.archivedAt && (
        <div className="flex justify-end">
          <AdvancePhaseDialog
            projectId={projectId}
            gateResult={gateResult}
            toLabel={next.label}
          />
        </div>
      )}

      {/* Open items */}
      <OpenItemsStrip items={openItemsSummary} />

      {/* Scope & cost — priced projects fold GL actuals into the scope table;
          non-priced projects keep the spec-only scope + a separate cost table. */}
      {isPriced ? (
        <PricedScopeTable
          items={pricedScopeRows}
          transactionsByCode={transactionsByCode}
        />
      ) : (
        <>
          <ScopeTable propertyId={propertyId} projectId={projectId} items={scopeRows} />
          <ProjectCostTable rows={costRows} total={spentAmt} />
        </>
      )}
    </>
  );

  const otherProjectOptions = otherProjects.filter((p) => p.id !== projectId);
  const audits = (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base text-navy">Site Audits</CardTitle>
        <AddAuditDialog
          propertyId={propertyId}
          propertySlug={slug}
          defaultAuditor={profile?.fullName ?? null}
          projects={[{ id: projectId, name: project.name }, ...otherProjectOptions]}
          defaultProjectId={projectId}
        />
      </CardHeader>
      <CardContent>
        <SiteAuditsTable propertySlug={slug} audits={projectAudits} findingsByAudit={findingsByAudit} />
      </CardContent>
    </Card>
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
                  {e.fromPhase ? `${phaseLabel(e.fromPhase)} → ` : ""}
                  {e.toPhase ? phaseLabel(e.toPhase) : e.fromPhase ? "" : "Created"}
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
          <Link
            href={project.kind === "unit" ? `/properties/${slug}/interiors` : `/properties/${slug}`}
            className="text-link hover:underline"
          >
            {project.kind === "unit" ? "← Unit Upgrades" : "← All projects"}
          </Link>
        </p>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-serif text-2xl font-semibold text-navy">{project.name}</h1>
            <StatusBadgeDropdown projectId={project.id} phase={project.phase} />
            {project.archivedAt && <Badge variant="secondary">Archived</Badge>}
          </div>
          <div className="flex items-center gap-2">
            {project.archivedAt ? (
              <RestoreProjectButton projectId={project.id} />
            ) : (
              <>
                <ProjectEditDialog
                  project={{
                    id: project.id,
                    name: project.name,
                    kind: project.kind,
                    startDate: project.startDate,
                    completeDate: project.completeDate,
                    notes: project.notes,
                    previousRent: project.previousRent,
                    tradeOutRent: project.tradeOutRent,
                    leaseDate: project.leaseDate,
                  }}
                />
                <ArchiveProjectDialog
                  propertySlug={slug}
                  projectId={project.id}
                  projectName={project.name}
                  redirectTo={
                    project.kind === "unit"
                      ? `/properties/${slug}/interiors`
                      : `/properties/${slug}`
                  }
                />
              </>
            )}
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          {costCode ? (
            <>UW line item: {costCode.name}</>
          ) : (
            "Interior unit turn — spend across all interior codes"
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
        audits={audits}
        log={log}
      />
    </div>
  );
}

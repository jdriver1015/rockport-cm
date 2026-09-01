import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { FileTextIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { readContracts } from "@/lib/contracts";
import { liveRfpCount, liveRfpLineIds } from "@/lib/scope-lock";
import { ProjectManageMenu } from "@/components/project-manage-menu";
import type { DocumentRow } from "@/components/document-manager";
import {
  ProjectScopeList,
  type ScopeRow,
  type ScopeCostCodeOption,
  type ScopeVendorOption,
  type CostCodeBudget,
} from "@/components/project-scope-list";
import { ProjectPhases, type PhaseRow } from "@/components/project-phases";
import { ProjectWorkPanels, ProjectPanelSwitch } from "@/components/project-work-panels";
import { evaluateGates } from "@/lib/phase-gates";
import { readPreconGateState } from "@/lib/precon-gate-state";
import { listPreWalkFindings } from "@/lib/pre-walk-findings";
import { readBidPackage } from "@/lib/bid-package";
import { fetchActivityLog } from "@/lib/actions/activity-log";
import { TierBadge } from "@/components/ui/tier-badge";
import { fmtDate, num } from "@/lib/format";
import { nextPhase } from "@/lib/stages";
import { createClient } from "@/lib/supabase/server";
import { parseProjectId, projectSlug } from "@/lib/slug";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Peripheral list loader. This page fans out ~10 queries; the project, its
 * scope, milestones, and GL are load-bearing, but the audit/document/log lists
 * are not. Without this a single flaky query — a pooled-connection timeout, say
 * — throws out of the Promise.all and the whole page renders as "This page
 * couldn't load" instead of the project. Degrade that section and keep the page.
 */
async function optional<T>(query: PromiseLike<T[]>, label: string): Promise<T[]> {
  try {
    return await query;
  } catch (err) {
    console.error(`project detail: ${label} failed to load`, err);
    return [];
  }
}

export default async function ProjectDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; projectId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { slug, projectId: pid } = await params;
  // Which panel the switch opens on. Anything but "workflow" — including a
  // stale or hand-typed value — falls back to the scope table.
  const initialTab = (await searchParams).tab === "workflow" ? "workflow" : "scope";
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
  const { project, unit } = data;

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
    glRows,
    findings,
    milestones,
    budgetGroups,
    vendorOptions,
  ] = await Promise.all([
    db()
      .select()
      .from(schema.scopeItems)
      .where(
        and(eq(schema.scopeItems.projectId, projectId), isNull(schema.scopeItems.archivedAt)),
      )
      .orderBy(asc(schema.scopeItems.sortOrder), asc(schema.scopeItems.id)),
    optional(
      fetchActivityLog(projectId),
      "activity log",
    ),
    optional(
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
      "documents",
    ),
    optional(
      db()
        .select()
        .from(schema.siteAudits)
        .where(and(eq(schema.siteAudits.projectId, projectId), isNull(schema.siteAudits.archivedAt)))
        .orderBy(desc(schema.siteAudits.auditDate), desc(schema.siteAudits.id)),
      "site audits",
    ),
    optional(
      db()
        .select({ id: schema.projects.id, name: schema.projects.name })
        .from(schema.projects)
        .where(and(eq(schema.projects.propertyId, propertyId), isNull(schema.projects.archivedAt)))
        .orderBy(asc(schema.projects.name)),
      "sibling projects",
    ),
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
    // This project's audit findings. One scoped query serves both the per-audit
    // counts and the open-items split — the counts used to aggregate every
    // finding in the database with no project filter.
    optional(
      db()
        .select({
          id: schema.auditFindings.id,
          auditId: schema.auditFindings.auditId,
          status: schema.auditFindings.status,
          dueDate: schema.auditFindings.dueDate,
        })
        .from(schema.auditFindings)
        .innerJoin(schema.siteAudits, eq(schema.auditFindings.auditId, schema.siteAudits.id))
        .where(
          and(
            eq(schema.siteAudits.projectId, projectId),
            isNull(schema.siteAudits.archivedAt),
            isNull(schema.auditFindings.archivedAt),
          ),
        ),
      "audit findings",
    ),
    db()
      .select({
        id: schema.projectMilestones.id,
        label: schema.projectMilestones.label,
        // Needed by the phase gate: "start milestone recorded" is the
        // in_process milestone's actual date, and labels have been renamed once.
        phase: schema.projectMilestones.phase,
        plannedDate: schema.projectMilestones.plannedDate,
        actualDate: schema.projectMilestones.actualDate,
        note: schema.projectMilestones.note,
        isDefault: schema.projectMilestones.isDefault,
      })
      .from(schema.projectMilestones)
      .where(
        and(eq(schema.projectMilestones.projectId, projectId), isNull(schema.projectMilestones.archivedAt)),
      )
      .orderBy(asc(schema.projectMilestones.sortOrder), asc(schema.projectMilestones.id)),
    // Unit projects only — for the tier badge, colored the same way as the budget pivot.
    db()
      .select({ id: schema.budgetGroups.id, name: schema.budgetGroups.name })
      .from(schema.budgetGroups)
      .where(and(eq(schema.budgetGroups.propertyId, propertyId), isNull(schema.budgetGroups.archivedAt)))
      .orderBy(asc(schema.budgetGroups.sortOrder), asc(schema.budgetGroups.name)),
    db()
      .select({ id: schema.vendors.id, name: schema.vendors.name, trade: schema.vendors.trade })
      .from(schema.vendors)
      .orderBy(asc(schema.vendors.name)),
  ]);

  const findingsByAudit = findings.reduce((m, f) => {
    m.set(f.auditId, (m.get(f.auditId) ?? 0) + 1);
    return m;
  }, new Map<number, number>());
  const openFindings = findings.filter((f) => f.status === "open");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const profile = user
    ? await db().query.profiles.findFirst({ where: eq(schema.profiles.id, user.id) })
    : null;

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
    status: s.status,
    quantity: s.quantity,
    unitPrice: s.unitPrice,
    costCodeId: s.costCodeId,
    vendorId: s.vendorId,
    startDate: s.startDate,
    endDate: s.endDate,
    specs: s.specs,
  }));

  const scopeVendors: ScopeVendorOption[] = vendorOptions;

  const activeCostCodes: ScopeCostCodeOption[] = await db()
    .select({ id: schema.costCodes.id, code: schema.costCodes.code, name: schema.costCodes.name })
    .from(schema.costCodes)
    .where(
      and(
        eq(schema.costCodes.chartId, property.chartOfAccountsId),
        eq(schema.costCodes.active, true),
        eq(schema.costCodes.isInterior, project.kind === "unit"),
      ),
    )
    .orderBy(asc(schema.costCodes.code));

  // What an awarded vendor is actually on the hook for, line by line. Only the
  // approved bids: an unawarded quote is a number somebody offered, not a
  // commitment. A direct award deliberately puts its whole amount on the first
  // line (see directAwardRows), so on those projects this is lumpy by design —
  // the scope table says so rather than pretending the split is real.
  const committedLineRows = await db()
    .select({
      scopeItemId: schema.bidLineItems.scopeItemId,
      amount: schema.bidLineItems.amount,
      source: schema.bids.source,
    })
    .from(schema.bidLineItems)
    .innerJoin(schema.bids, eq(schema.bids.id, schema.bidLineItems.bidId))
    .where(
      and(
        eq(schema.bids.projectId, projectId),
        eq(schema.bids.approved, true),
        isNull(schema.bids.archivedAt),
      ),
    );

  // Which lines a vendor is currently holding. RFPs go out for a SUBSET of the
  // scope, so this is per line — the project-wide lock froze a whole table when
  // two of its six lines were out. Read through the same function the server
  // guard uses, so what the row shows and what an edit is allowed to do cannot
  // drift apart. Null means an unscoped request, which holds the whole scope.
  const heldLineIds = await liveRfpLineIds(projectId);
  const outForBidLineIds = heldLineIds ? [...heldLineIds] : scope.map((r) => r.id);

  // A unit turn's allowance is its tier's PER-UNIT line, not the property's
  // whole underwritten figure for the code. Comparing one unit's $1,850 floor
  // against the property's $340,000 flooring budget is true and useless.
  const perUnitBudgetByCode: Record<number, number> = {};
  if (project.kind === "unit" && project.budgetGroupId != null) {
    const tierLines = await db()
      .select({
        costCodeId: schema.budgetGroupLines.costCodeId,
        unitPrice: schema.budgetGroupLines.unitPrice,
        pricingMethod: schema.budgetGroupLines.pricingMethod,
      })
      .from(schema.budgetGroupLines)
      .where(eq(schema.budgetGroupLines.budgetGroupId, project.budgetGroupId));

    for (const l of tierLines) {
      // The rule interior-budget.ts uses: a sqft-priced line is a rate, so the
      // unit's own square footage turns it into money.
      perUnitBudgetByCode[l.costCodeId] =
        l.pricingMethod === "sqft" ? num(l.unitPrice) * (unit?.sqft ?? 0) : num(l.unitPrice);
    }
  }

  const committedByLine: Record<number, number> = {};
  for (const r of committedLineRows) {
    if (r.scopeItemId == null) continue;
    committedByLine[r.scopeItemId] = (committedByLine[r.scopeItemId] ?? 0) + num(r.amount);
  }
  const awardIsDirect = committedLineRows.some((r) => r.source === "direct");

  const actualByCode: Record<number, number> = {};
  for (const r of glRows) {
    if (r.costCodeId == null) continue;
    actualByCode[r.costCodeId] = (actualByCode[r.costCodeId] ?? 0) + num(r.amount);
  }

  // Underwriting budget per code, and everything already allocated to it across
  // the whole property's scope items — feeds the "remaining budget" preview in
  // the scope item dialog.
  const [budgetLineRows, allPropertyScope] = await Promise.all([
    db()
      .select({ costCodeId: schema.budgetLines.costCodeId, uwAmount: schema.budgetLines.uwAmount })
      .from(schema.budgetLines)
      .where(and(eq(schema.budgetLines.propertyId, propertyId), isNull(schema.budgetLines.archivedAt))),
    db()
      .select({
        costCodeId: schema.scopeItems.costCodeId,
        quantity: schema.scopeItems.quantity,
        unitPrice: schema.scopeItems.unitPrice,
      })
      .from(schema.scopeItems)
      .innerJoin(schema.projects, eq(schema.scopeItems.projectId, schema.projects.id))
      .where(and(eq(schema.projects.propertyId, propertyId), isNull(schema.scopeItems.archivedAt))),
  ]);

  const budgetByCode: Record<number, CostCodeBudget> = {};
  for (const c of activeCostCodes) budgetByCode[c.id] = { budget: 0, allocated: 0 };
  for (const b of budgetLineRows) {
    if (b.costCodeId == null) continue;
    budgetByCode[b.costCodeId] ??= { budget: 0, allocated: 0 };
    budgetByCode[b.costCodeId].budget += num(b.uwAmount);
  }
  for (const s of allPropertyScope) {
    if (s.costCodeId == null) continue;
    budgetByCode[s.costCodeId] ??= { budget: 0, allocated: 0 };
    budgetByCode[s.costCodeId].allocated += num(s.quantity) * num(s.unitPrice);
  }

  // --- Header KPIs ---
  const spentAmt = glRows.reduce((s, r) => s + num(r.amount), 0);

  const tierIndexById = new Map(budgetGroups.map((g, i) => [g.id, i]));
  const tierName =
    project.kind === "unit" && project.budgetGroupId != null
      ? budgetGroups.find((g) => g.id === project.budgetGroupId)?.name
      : undefined;
  const tierIndex = project.budgetGroupId != null ? tierIndexById.get(project.budgetGroupId) ?? 0 : 0;

  const phaseRows: PhaseRow[] = milestones.map((m) => ({
    id: m.id,
    label: m.label,
    phase: m.phase,
    plannedDate: m.plannedDate,
    actualDate: m.actualDate,
    note: m.note,
    isDefault: m.isDefault,
  }));



  // The next phase is the one after the phase the project is IN, not the first
  // row with no actual date. On a project in Complete that read "next
  // Pre-Construction", because the Pre-Construction row is stamped by hand and
  // is usually left blank.
  const upcoming = nextPhase(project.phase);
  const nextMilestone = upcoming
    ? (milestones.find((m) => m.phase === upcoming.key) ?? null)
    : null;

  const otherProjectOptions = otherProjects.filter((p) => p.id !== projectId);

  // Gate checks for leaving the phase the project is in. Every input is state
  // the page already loaded, so the checks cannot disagree with what the rest of
  // the screen shows. src/lib/phase-gates.ts held these but nothing rendered
  // them — they were only reachable from a dialog no page mounted.
  const startMilestone = milestones.find((m) => m.phase === "in_process");
  // The same reader the server-side check uses, so what the section shows and
  // what an advance is allowed to do cannot drift apart.
  const precon = await readPreconGateState(projectId);
  // The Define Scope gate offers the walk's findings, so they load with the
  // page rather than on opening the dialog — it is one small query and the
  // dialog is a click away from the gate that describes it.
  const preWalkFindings = await optional(
    listPreWalkFindings(projectId).then((r) => r),
    "pre-walk findings",
  );
  // Guarded like the findings: the Select Bid dialog is a click away from the
  // gate, and the project has to open even if the bid read fails.
  const bidPackage = (await readBidPackage(propertyId, projectId).catch((err) => {
    console.error("project detail: bid package failed to load", err);
    return { scopeItems: [], vendors: [], bids: [], lineAmounts: [] };
  }))!;
  // The bids the contracts are for. Read off the package rather than queried
  // again so the dialog names exactly what the Select Bid screen shows as
  // awarded — and a split job has one award per vendor, not one per project.
  const awardedBids = bidPackage.bids.filter((b) => b.approved);
  const liveContracts = await readContracts(projectId);
  // The very function the guard uses, not a re-derivation from the bid list —
  // a direct award is status "received" with no RFP behind it, so counting
  // statuses here would freeze a scope nobody is pricing.
  const liveRfps = await liveRfpCount(projectId);
  const scopeLocked = liveRfps > 0;


  const gate = upcoming
    ? evaluateGates(project.phase, upcoming.key, {
        ...precon,
        hasStartMilestoneActual: !!startMilestone?.actualDate,
        openFindingCount: openFindings.length,
        postedGlTotal: spentAmt,
      })
    : null;
  return (
    <div className="space-y-6">
      <p className="text-sm">
        {/* Unit turns and common-area work share the Projects board now, so both
            kinds go back to the same place. */}
        <Link href={`/properties/${slug}`} className="text-link hover:underline">
          ← All projects
        </Link>
      </p>

      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex flex-col gap-2">
              {(tierName || project.archivedAt) && (
                // The Unit/Common badge is gone: the breadcrumb above and the unit
                // number below already say which you are in, and it was the first
                // thing on a page whose subject is the project.
                <div className="flex flex-wrap items-center gap-2">
                  {tierName && <TierBadge label={tierName} index={tierIndex} />}
                  {project.archivedAt && <Badge variant="secondary">Archived</Badge>}
                </div>
              )}
              <h1 className="font-serif text-2xl font-semibold text-navy">{project.name}</h1>
              {/*
                The UW line item used to sit here. A project does not have one —
                its scope lines do, and this project's four lines span four
                different categories. Naming one of them at the top of the page
                described the project as something it is not.
              */}
              {unit && (
                <p className="text-sm text-muted-foreground">Unit {unit.unitNumber}</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {/* A link, not a button with an onClick: the route streams a PDF,
                  so letting the browser open it is the whole behaviour. */}
              <a
                href={`/api/projects/${projectId}/export`}
                target="_blank"
                rel="noreferrer"
                className={cn(buttonVariants({ size: "sm", variant: "outline" }))}
              >
                <FileTextIcon className="size-3.5" />
                Export PDF
              </a>
              <ProjectManageMenu
              propertyId={propertyId}
              propertySlug={slug}
              projectId={projectId}
              projectName={project.name}
              archived={project.archivedAt != null}
              documents={documentRows}
              activityLog={auditLog}
              editData={{
                id: project.id,
                name: project.name,
                kind: project.kind,
                costCodeId: project.costCodeId,
                budgetAmount: project.budgetAmount,
                startDate: project.startDate,
                completeDate: project.completeDate,
                notes: project.notes,
                previousRent: project.previousRent,
                tradeOutRent: project.tradeOutRent,
                leaseDate: project.leaseDate,
              }}
              audits={projectAudits}
              findingsByAudit={findingsByAudit}
              auditProjects={[{ id: projectId, name: project.name }, ...otherProjectOptions]}
              costCodes={activeCostCodes}
              defaultAuditor={profile?.fullName ?? null}
              />
            </div>
          </div>
        </CardContent>
      </Card>


      <ProjectWorkPanels
        initialTab={initialTab}
        scopeCount={scopeRows.length}
        gate={gate ? { met: gate.metCount, total: gate.checks.length } : null}
        scope={
          <ProjectScopeList
            propertyId={propertyId}
            projectId={projectId}
            items={scopeRows}
            costCodes={activeCostCodes}
            vendors={scopeVendors}
            actualByCode={actualByCode}
            budgetByCode={budgetByCode}
            committedByLine={committedByLine}
            awardIsDirect={awardIsDirect}
            outForBidLineIds={outForBidLineIds}
            perUnitBudgetByCode={project.kind === "unit" ? perUnitBudgetByCode : null}
            tierName={tierName ?? null}
            scopeConfirmedAt={precon.scopeConfirmedAt?.toISOString().slice(0, 10) ?? null}
            scopeLocked={scopeLocked}
            liveRfpCount={liveRfps}
          />
        }
        workflow={
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <ProjectPanelSwitch />
              <span className="text-sm text-muted-foreground">
                {nextMilestone
                  ? `Next up: ${nextMilestone.label}${nextMilestone.plannedDate ? ` · targeted to begin ${fmtDate(nextMilestone.plannedDate)}` : ""}`
                  : "Final phase"}
              </span>
            </CardHeader>
            <CardContent>
              <ProjectPhases
                projectId={projectId}
                phases={phaseRows}
                currentPhase={project.phase}
                gateContext={{
                  propertyId,
                  propertySlug: slug,
                  scopeLineCount: scopeRows.length,
                  scopeLines: scopeRows.map((r) => ({
                    id: r.id,
                    item: r.item,
                    materialQuality: r.materialQuality,
                    quantity: r.quantity,
                    unitPrice: r.unitPrice,
                    costCodeName:
                      activeCostCodes.find((c) => c.id === r.costCodeId)?.name ?? null,
                  })),
                  scopeLocked,
                  scopeConfirmedAt: precon.scopeConfirmedAt?.toISOString().slice(0, 10) ?? null,
                  preWalkFindings,
                  bidPackage,
                  preWalkDate: precon.preWalkDate,
                  preWalkTime: precon.preWalkTime,
                  preWalkAuditId: precon.preWalkAuditId,
                  preWalkAuditStatus: precon.preWalkAuditStatus,
                  contracts: liveContracts.map((c) => ({
                    ...c,
                    sentAt: c.sentAt?.toISOString() ?? null,
                    vendorSignedAt: c.vendorSignedAt?.toISOString() ?? null,
                    executedAt: c.executedAt?.toISOString() ?? null,
                  })),
                  awards: awardedBids.map((b) => ({
                    bidId: b.id,
                    vendorName: b.vendorName,
                    total: b.total,
                  })),
                }}
                gate={gate}
                nextPhaseLabel={upcoming?.label ?? null}
              />
            </CardContent>
          </Card>
        }
      />
    </div>
  );
}

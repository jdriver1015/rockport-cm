import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ProjectCostBar } from "@/components/project-cost-bar";
import { daysSince } from "@/lib/duration";
import { readPhaseClock } from "@/lib/phase-clock";
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
import { evaluateGates } from "@/lib/phase-gates";
import { readPreconGateState } from "@/lib/precon-gate-state";
import { listPreWalkFindings } from "@/lib/pre-walk-findings";
import { readBidPackage } from "@/lib/bid-package";
import { OpenItemsStrip, type OpenItemsSummary } from "@/components/open-items-strip";
import { ActivityLogDialogButton, type LogEntry } from "@/components/project-log-dialog";
import { TierBadge } from "@/components/ui/tier-badge";
import { fmtDate, num } from "@/lib/format";
import { nextPhase } from "@/lib/stages";
import { phaseLabel } from "@/lib/stages";
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

function HeaderKpi({
  label,
  value,
  note,
  valueClassName,
  noteClassName,
}: {
  label: string;
  value: string;
  note?: string;
  valueClassName?: string;
  noteClassName?: string;
}) {
  return (
    <div>
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-ink-300">{label}</div>
      <div className={cn("mt-1 truncate tabular-nums text-sm font-semibold text-navy", valueClassName)}>
        {value}
      </div>
      {note && (
        <div className={cn("mt-1 truncate text-[10.5px] text-muted-foreground", noteClassName)}>{note}</div>
      )}
    </div>
  );
}

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
      db()
        .select()
        .from(schema.projectStageEvents)
        .where(eq(schema.projectStageEvents.projectId, projectId))
        .orderBy(desc(schema.projectStageEvents.createdAt))
        .limit(100),
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
  const budgetAmt = num(project.budgetAmount);
  const committedAmt = num(project.committedCost);
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



  const slips = milestones
    .map((m) => {
      if (!m.plannedDate || !m.actualDate) return null;
      const p = new Date(m.plannedDate + "T00:00:00");
      const a = new Date(m.actualDate + "T00:00:00");
      return Math.round((a.getTime() - p.getTime()) / 86_400_000);
    })
    .filter((d): d is number => d !== null);
  const worstSlipEntry = milestones.reduce<{ days: number; label: string } | null>((worst, m) => {
    if (!m.plannedDate || !m.actualDate) return worst;
    const p = new Date(m.plannedDate + "T00:00:00");
    const a = new Date(m.actualDate + "T00:00:00");
    const d = Math.round((a.getTime() - p.getTime()) / 86_400_000);
    return worst == null || d > worst.days ? { days: d, label: m.label } : worst;
  }, null);
  const worstSlip = slips.length ? Math.max(...slips) : null;

  // The next phase is the one after the phase the project is IN, not the first
  // row with no actual date. On a project in Complete that read "next
  // Pre-Construction", because the Pre-Construction row is stamped by hand and
  // is usually left blank.
  const upcoming = nextPhase(project.phase);
  const nextMilestone = upcoming
    ? (milestones.find((m) => m.phase === upcoming.key) ?? null)
    : null;

  // Drives the "Over budget" pill beside the title. The cost bar owns the rest
  // of the money story now, including the amount and the share of approved.
  const isOverBudget = budgetAmt > 0 && spentAmt > budgetAmt;

  const scheduleNote =
    worstSlipEntry && worstSlipEntry.days > 0
      ? `Worst slip: ${worstSlipEntry.label}`
      : milestones.length > 0
        ? "No slippage recorded"
        : undefined;


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
    return { scopeItems: [], vendors: [], bids: [] };
  }))!;
  // The bid the contract is for. Read off the package rather than queried again
  // so the dialog names exactly the bid the Select Bid screen shows as awarded.
  const awardedBid = bidPackage.bids.find((b) => b.approved) ?? null;

  const clock = await readPhaseClock(projectId, project.phase);
  const daysInPhase = daysSince(clock.phaseEnteredAt);
  const daysInTurn = daysSince(project.startDate ?? clock.startedAt);

  // What the bids say the job costs, for the pre-con state where no budget has
  // been approved yet. That is the live money question during pre-con, and the
  // header could not answer it at all.
  const bidTotals = bidPackage.bids.filter((b) => b.total > 0).map((b) => b.total);
  const bidRange = bidTotals.length
    ? { low: Math.min(...bidTotals), high: Math.max(...bidTotals) }
    : null;
  const gate = upcoming
    ? evaluateGates(project.phase, upcoming.key, {
        ...precon,
        scopeNotStartedCount: scopeRows.filter((r) => r.status === "not_started").length,
        scopeCompleteCount: scopeRows.filter((r) => r.status === "complete").length,
        scopeTotalCount: scopeRows.length,
        hasStartMilestoneActual: !!startMilestone?.actualDate,
        openFindingCount: openFindings.length,
        postedGlTotal: spentAmt,
      })
    : null;
  // Phase labels resolve here so the log dialog stays a presentational client component.
  const logEntries: LogEntry[] = auditLog.map((e) => ({
    id: e.id,
    createdAt: e.createdAt,
    fromPhase: e.fromPhase,
    toPhase: e.toPhase,
    fromPhaseLabel: e.fromPhase ? phaseLabel(e.fromPhase) : null,
    toPhaseLabel: e.toPhase ? phaseLabel(e.toPhase) : null,
    note: e.note,
  }));

  return (
    <div className="space-y-6">
      <p className="text-sm">
        <Link
          href={project.kind === "unit" ? `/properties/${slug}/interiors` : `/properties/${slug}`}
          className="text-link hover:underline"
        >
          {project.kind === "unit" ? "← Unit Upgrades" : "← All projects"}
        </Link>
      </p>

      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="text-[10.5px] font-bold uppercase tracking-[0.09em]">
                  {project.kind === "unit" ? "Unit" : "Common"}
                </Badge>
                {tierName && <TierBadge label={tierName} index={tierIndex} />}
                {isOverBudget && (
                  <Badge className="bg-alert/10 text-alert">Over budget</Badge>
                )}
                {project.archivedAt && <Badge variant="secondary">Archived</Badge>}
              </div>
              <h1 className="font-serif text-2xl font-semibold text-navy">{project.name}</h1>
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
            <ProjectManageMenu
              propertyId={propertyId}
              propertySlug={slug}
              projectId={projectId}
              projectName={project.name}
              projectKind={project.kind}
              archived={project.archivedAt != null}
              documents={documentRows}
              activityLog={logEntries}
              editData={{
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
              audits={projectAudits}
              findingsByAudit={findingsByAudit}
              auditProjects={[{ id: projectId, name: project.name }, ...otherProjectOptions]}
              defaultAuditor={profile?.fullName ?? null}
            />
          </div>

          <div className="mx-[calc(var(--card-spacing)*-1)] grid grid-cols-2 border-y border-border sm:grid-cols-5 [&>*]:border-border [&>*]:px-[var(--card-spacing)] [&>*]:py-3.5 sm:[&>*:not(:first-child)]:border-l">
            <div className="col-span-2 sm:col-span-3">
              <ProjectCostBar
                approved={budgetAmt}
                committed={committedAmt}
                actual={spentAmt}
                bidRange={bidRange}
              />
            </div>
            <HeaderKpi
              label="In this phase"
              value={daysInPhase == null ? "\u2014" : `${daysInPhase}d`}
              note={scheduleNote}
              noteClassName={worstSlip != null && worstSlip > 0 ? "text-alert" : undefined}
            />
            <HeaderKpi label="Turn to date" value={daysInTurn == null ? "\u2014" : `${daysInTurn}d`} />
          </div>

          <div className="pt-1">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-base font-semibold text-navy">Project phases</h2>
              <span className="text-sm text-muted-foreground">
                {nextMilestone
                  ? `Next up: ${nextMilestone.label}${nextMilestone.plannedDate ? ` · planned ${fmtDate(nextMilestone.plannedDate)}` : ""}`
                  : "Final phase"}
              </span>
            </div>
            <ProjectPhases
              projectId={projectId}
              phases={phaseRows}
              currentPhase={project.phase}
              gateContext={{
                propertyId,
                propertySlug: slug,
                scopeLineCount: scopeRows.length,
                scopeConfirmedAt: precon.scopeConfirmedAt?.toISOString() ?? null,
                preWalkFindings,
                bidPackage,
                preWalkDate: precon.preWalkDate,
                preWalkTime: precon.preWalkTime,
                preWalkAuditId: precon.preWalkAuditId,
                preWalkAuditStatus: precon.preWalkAuditStatus,
                contractSignedAt: precon.contractSignedAt,
                award: awardedBid
                  ? { vendorName: awardedBid.vendorName, total: awardedBid.total }
                  : null,
              }}
              gate={gate}
              nextPhaseLabel={upcoming?.label ?? null}
            />
          </div>
        </CardContent>
      </Card>

      <OpenItemsStrip items={openItemsSummary} />

      <ProjectScopeList
        propertyId={propertyId}
        projectId={projectId}
        items={scopeRows}
        costCodes={activeCostCodes}
        vendors={scopeVendors}
        actualByCode={actualByCode}
        budgetByCode={budgetByCode}
        approvedBudget={budgetAmt}
      />
    </div>
  );
}

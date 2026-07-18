import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
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
import type { PricingMethod } from "@/lib/pricing";
import { BidsCard, type BidRow, type BidderVendor } from "@/components/bids-card";
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

  // None of these depend on each other — run them as one parallel batch rather
  // than six sequential round-trips to the pooled Supabase connection.
  const [scope, auditLog, docs, bidJoins, activeVendors, activeContacts] = await Promise.all([
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
    // Bids with their vendor/contact names.
    db()
      .select({
        bid: schema.bids,
        vendorName: schema.vendors.name,
        contactName: schema.vendorContacts.name,
      })
      .from(schema.bids)
      .leftJoin(schema.vendors, eq(schema.bids.vendorId, schema.vendors.id))
      .leftJoin(
        schema.vendorContacts,
        eq(schema.bids.submittedByContactId, schema.vendorContacts.id),
      )
      .where(and(eq(schema.bids.projectId, projectId), isNull(schema.bids.archivedAt)))
      .orderBy(asc(schema.bids.bidNumber)),
    // Active-vendor roster for the add-bid dropdowns.
    db()
      .select()
      .from(schema.vendors)
      .where(eq(schema.vendors.active, true))
      .orderBy(asc(schema.vendors.name)),
    db()
      .select()
      .from(schema.vendorContacts)
      .where(eq(schema.vendorContacts.active, true))
      .orderBy(asc(schema.vendorContacts.name)),
  ]);

  const documentRows: DocumentRow[] = docs.map((d) => ({
    id: d.id,
    name: d.caption ?? d.storagePath.split("/").pop() ?? "document",
    caption: d.caption,
    createdAt: d.createdAt,
  }));

  // Line items for every bid on this project, grouped per bid; the bid total is
  // the sum of its lines (derived, not stored).
  const bidIds = bidJoins.map((b) => b.bid.id);
  const allLines = bidIds.length
    ? await db()
        .select()
        .from(schema.bidLineItems)
        .where(inArray(schema.bidLineItems.bidId, bidIds))
        .orderBy(asc(schema.bidLineItems.sortOrder), asc(schema.bidLineItems.id))
    : [];
  const linesByBid = new Map<number, typeof allLines>();
  for (const l of allLines) {
    const arr = linesByBid.get(l.bidId) ?? [];
    arr.push(l);
    linesByBid.set(l.bidId, arr);
  }

  const bidRows: BidRow[] = bidJoins.map(({ bid, vendorName, contactName }) => {
    const lines = (linesByBid.get(bid.id) ?? []).map((l) => ({
      id: l.id,
      scopeItemId: l.scopeItemId,
      description: l.description,
      amount: l.amount,
    }));
    const total = lines.reduce((s, l) => s + num(l.amount), 0);
    return {
      id: bid.id,
      vendorName: vendorName ?? "—",
      contactName,
      total,
      receivedDate: bid.receivedDate,
      approved: bid.approved,
      note: bid.note,
      lines,
    };
  });

  const bidderVendors: BidderVendor[] = activeVendors.map((v) => ({
    id: v.id,
    name: v.name,
    contacts: activeContacts
      .filter((c) => c.vendorId === v.id)
      .map((c) => ({ id: c.id, name: c.name })),
  }));

  const tradeOut =
    project.previousRent && project.tradeOutRent
      ? num(project.tradeOutRent) - num(project.previousRent)
      : null;

  const scopeRows: ScopeRow[] = scope.map((s) => ({
    id: s.id,
    item: s.item,
    materialQuality: s.materialQuality,
    productLink: s.productLink,
  }));

  // Interior projects carry generated pricing on their scope items; resolve the
  // code strings and render the priced view instead of the spec-only table.
  const scopeCodeIds = [...new Set(scope.map((s) => s.costCodeId).filter((c): c is number => !!c))];
  const scopeCodes = scopeCodeIds.length
    ? await db()
        .select({ id: schema.costCodes.id, code: schema.costCodes.code })
        .from(schema.costCodes)
        .where(inArray(schema.costCodes.id, scopeCodeIds))
    : [];
  const codeById = new Map(scopeCodes.map((c) => [c.id, c.code]));
  const isPriced = project.kind === "unit" && scope.some((s) => s.pricingMethod != null);
  const pricedScopeRows: PricedScopeRow[] = scope.map((s) => ({
    id: s.id,
    item: s.item,
    materialQuality: s.materialQuality,
    pricingMethod: s.pricingMethod as PricingMethod | null,
    unitPrice: s.unitPrice,
    quantity: s.quantity,
    costCode: s.costCodeId != null ? codeById.get(s.costCodeId) ?? null : null,
  }));

  const overview = (
    <>
      {isPriced ? (
        <PricedScopeTable items={pricedScopeRows} />
      ) : (
        <ScopeTable propertyId={propertyId} projectId={projectId} items={scopeRows} />
      )}

      <BidsCard
        propertyId={propertyId}
        projectId={projectId}
        bids={bidRows}
        vendors={bidderVendors}
        scopeItems={scope.map((s) => ({ id: s.id, item: s.item }))}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base text-navy">Details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:max-w-md">
            <dt className="text-muted-foreground">Budget</dt>
            <dd className="tabular-nums">{money(project.budgetAmount)}</dd>
            {project.kind === "unit" && (
              <>
                <dt className="text-muted-foreground">Pre-walk date</dt>
                <dd>{fmtDate(project.preWalkDate)}</dd>
              </>
            )}
            <dt className="text-muted-foreground">Start date</dt>
            <dd>{fmtDate(project.startDate)}</dd>
            {project.kind === "unit" && (
              <>
                <dt className="text-muted-foreground">Target completion</dt>
                <dd>{fmtDate(project.targetCompletionDate)}</dd>
              </>
            )}
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
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-serif text-2xl font-semibold text-navy">{project.name}</h1>
            <StatusBadgeDropdown projectId={project.id} stage={project.stage} />
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
                  propertyId={propertyId}
                  projectId={project.id}
                  projectName={project.name}
                />
              </>
            )}
          </div>
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

import { and, asc, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { readCoverage } from "@/lib/award-coverage";
import { readContracts, type ContractStatus } from "@/lib/contracts";
import { num } from "@/lib/format";
import { scopeLineTotal } from "@/lib/scope-total";
import { phaseLabel } from "@/lib/stages";

// ---------------------------------------------------------------------------
// Everything the exported project sheet says, read once.
//
// Deliberately built on the same readers the project screen uses —
// readCoverage, readContracts, the per-line committed query — rather than a
// second set of queries that agree today. A PDF gets emailed and then argued
// with weeks later; the one thing it must not do is disagree with the screen it
// was exported from.
// ---------------------------------------------------------------------------

export type SheetScopeLine = {
  item: string;
  category: string | null;
  description: string | null;
  specs: string[];
  vendorName: string | null;
  budgeted: number | null;
  committed: number | null;
  /** Posted spend, when this line is the only claim on its category. */
  actual: number | null;
  /** True when the figure above belongs to the category, not this line alone. */
  actualIsCategory: boolean;
};

export type SheetAward = {
  vendorName: string;
  covers: string;
  amount: number;
  contract: string;
};

export type SheetPhase = {
  label: string;
  planned: string | null;
  actual: string | null;
  varianceDays: number | null;
};

export type ProjectSheet = {
  propertyName: string;
  projectName: string;
  unitNumber: string | null;
  phase: string;
  generatedAt: string;
  approvedBudget: number;
  budgeted: number;
  committed: number;
  actual: number;
  scopeConfirmedAt: string | null;
  lines: SheetScopeLine[];
  awards: SheetAward[];
  phases: SheetPhase[];
};

const CONTRACT_LABEL: Record<ContractStatus, string> = {
  draft: "Drafted, not sent",
  out_for_signature: "Out for signature",
  vendor_signed: "Awaiting countersign",
  executed: "Executed",
  voided: "Voided",
};

function fmt(d: string | null): string | null {
  if (!d) return null;
  const parsed = new Date(`${d}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
}

export async function readProjectSheet(projectId: number): Promise<ProjectSheet | null> {
  const [row] = await db()
    .select({
      project: schema.projects,
      propertyName: schema.properties.name,
      unitNumber: schema.units.unitNumber,
    })
    .from(schema.projects)
    .innerJoin(schema.properties, eq(schema.properties.id, schema.projects.propertyId))
    .leftJoin(schema.units, eq(schema.units.id, schema.projects.unitId))
    .where(eq(schema.projects.id, projectId))
    .limit(1);
  if (!row) return null;
  const { project } = row;

  const [scope, milestones, coverage, contracts, committedRows, glRows] = await Promise.all([
    db()
      .select({
        id: schema.scopeItems.id,
        item: schema.scopeItems.item,
        description: schema.scopeItems.materialQuality,
        specs: schema.scopeItems.specs,
        costCodeId: schema.scopeItems.costCodeId,
        categoryName: schema.costCodes.name,
        quantity: schema.scopeItems.quantity,
        unitPrice: schema.scopeItems.unitPrice,
        vendorName: schema.vendors.name,
      })
      .from(schema.scopeItems)
      .leftJoin(schema.costCodes, eq(schema.costCodes.id, schema.scopeItems.costCodeId))
      .leftJoin(schema.vendors, eq(schema.vendors.id, schema.scopeItems.vendorId))
      .where(
        and(eq(schema.scopeItems.projectId, projectId), isNull(schema.scopeItems.archivedAt)),
      )
      .orderBy(asc(schema.scopeItems.sortOrder), asc(schema.scopeItems.id)),
    db()
      .select({
        label: schema.projectMilestones.label,
        plannedDate: schema.projectMilestones.plannedDate,
        actualDate: schema.projectMilestones.actualDate,
        isDefault: schema.projectMilestones.isDefault,
        sortOrder: schema.projectMilestones.sortOrder,
      })
      .from(schema.projectMilestones)
      .where(
        and(
          eq(schema.projectMilestones.projectId, projectId),
          isNull(schema.projectMilestones.archivedAt),
        ),
      )
      .orderBy(asc(schema.projectMilestones.sortOrder), asc(schema.projectMilestones.id)),
    readCoverage(projectId),
    readContracts(projectId),
    db()
      .select({
        scopeItemId: schema.bidLineItems.scopeItemId,
        amount: schema.bidLineItems.amount,
      })
      .from(schema.bidLineItems)
      .innerJoin(schema.bids, eq(schema.bids.id, schema.bidLineItems.bidId))
      .where(
        and(
          eq(schema.bids.projectId, projectId),
          eq(schema.bids.approved, true),
          isNull(schema.bids.archivedAt),
        ),
      ),
    db()
      .select({ costCodeId: schema.glTransactions.costCodeId, amount: schema.glTransactions.amount })
      .from(schema.glTransactions)
      .where(
        and(
          eq(schema.glTransactions.projectId, projectId),
          eq(schema.glTransactions.status, "posted"),
        ),
      ),
  ]);

  const committedByLine = new Map<number, number>();
  for (const r of committedRows) {
    if (r.scopeItemId == null) continue;
    committedByLine.set(r.scopeItemId, (committedByLine.get(r.scopeItemId) ?? 0) + num(r.amount));
  }

  const actualByCode = new Map<number, number>();
  for (const r of glRows) {
    if (r.costCodeId == null) continue;
    actualByCode.set(r.costCodeId, (actualByCode.get(r.costCodeId) ?? 0) + num(r.amount));
  }

  // How many lines sit on each category — the same rule the table uses to decide
  // whether posted spend can be read as this line's or only as the category's.
  const sharing = new Map<number, number>();
  for (const s of scope) {
    if (s.costCodeId == null) continue;
    sharing.set(s.costCodeId, (sharing.get(s.costCodeId) ?? 0) + 1);
  }

  const lines: SheetScopeLine[] = scope.map((s) => {
    const shares = s.costCodeId != null ? (sharing.get(s.costCodeId) ?? 1) : 1;
    const codeActual = s.costCodeId != null ? (actualByCode.get(s.costCodeId) ?? 0) : 0;
    return {
      item: s.item,
      category: s.categoryName,
      description: s.description,
      specs: (s.specs?.rows ?? [])
        .filter((r) => r.some((c) => c.trim()))
        .map((r) => r.filter(Boolean).join(" · ")),
      vendorName: s.vendorName,
      budgeted: scopeLineTotal(s),
      committed: committedByLine.get(s.id) ?? null,
      actual: s.costCodeId == null ? null : codeActual,
      actualIsCategory: shares > 1,
    };
  });

  // Each category's posted spend counted once, however many lines sit on it.
  const actual = [...actualByCode.values()].reduce((a, b) => a + b, 0);

  const contractByBid = new Map(contracts.map((c) => [c.bidId, c]));
  const awardedBidIds = [...new Set([...coverage.coverage.values()].map((h) => h.bidId))];
  const lineNameById = new Map(scope.map((s) => [s.id, s.item]));

  const awards: SheetAward[] = awardedBidIds.map((bidId) => {
    const holder = [...coverage.coverage.values()].find((h) => h.bidId === bidId)!;
    // By line id, not by name: two lines can share a name, and matching on it
    // would credit one award with the other's money.
    const coveredIds = [...coverage.coverage.entries()]
      .filter(([, h]) => h.bidId === bidId)
      .map(([lineId]) => lineId);
    const contract = contractByBid.get(bidId);
    return {
      vendorName: holder.vendorName ?? `Bid #${holder.bidNumber}`,
      covers:
        coveredIds.length === scope.length
          ? "Whole scope"
          : coveredIds.map((id) => lineNameById.get(id)).filter(Boolean).join(", ") || "—",
      amount: coveredIds.reduce((sum, id) => sum + (committedByLine.get(id) ?? 0), 0),
      contract: contract
        ? `${CONTRACT_LABEL[contract.status]}${contract.executedAt ? ` ${fmt(contract.executedAt.toISOString().slice(0, 10)) ?? ""}` : ""}`
        : "Not generated",
    };
  });

  const phases: SheetPhase[] = milestones
    .filter((m) => m.isDefault)
    .map((m) => {
      const variance =
        m.plannedDate && m.actualDate
          ? Math.round(
              (new Date(`${m.actualDate}T00:00:00`).getTime() -
                new Date(`${m.plannedDate}T00:00:00`).getTime()) /
                86_400_000,
            )
          : null;
      return {
        label: m.label,
        planned: fmt(m.plannedDate),
        actual: fmt(m.actualDate),
        varianceDays: variance,
      };
    });

  return {
    propertyName: row.propertyName,
    projectName: project.name,
    unitNumber: row.unitNumber ?? null,
    phase: phaseLabel(project.phase),
    generatedAt: new Date().toLocaleDateString("en-US", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }),
    approvedBudget: num(project.budgetAmount),
    budgeted: lines.reduce((s, l) => s + (l.budgeted ?? 0), 0),
    committed: lines.reduce((s, l) => s + (l.committed ?? 0), 0),
    actual,
    scopeConfirmedAt: project.scopeConfirmedAt
      ? fmt(project.scopeConfirmedAt.toISOString().slice(0, 10))
      : null,
    lines,
    awards,
    phases,
  };
}

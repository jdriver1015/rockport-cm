import { and, asc, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { fillTemplate } from "@/lib/contract-template-starter";
import type { ContractData, ContractLine } from "@/lib/contract-document";

// ---------------------------------------------------------------------------
// Contracts.
//
// Plain functions, not the actions — revalidatePath throws outside a request,
// and this is the logic worth exercising.
//
// The shape to hold on to: a contract row is a SNAPSHOT. The template can be
// edited, the scope can change, the vendor can be renamed; none of that may
// alter a document somebody has already signed. So generating copies the terms
// into body_snapshot and the price into amount, and rendering reads the copy.
// ---------------------------------------------------------------------------

/** Who the owner is on the document. No multi-entity support yet. */
const COMPANY = "Westcreek Capital";

export type ContractStatus =
  | "draft"
  | "out_for_signature"
  | "vendor_signed"
  | "executed"
  | "voided";

export type ContractSummary = {
  id: number;
  status: ContractStatus;
  amount: number;
  vendorName: string | null;
  contractNumber: string;
  createdAt: Date;
  sentAt: Date | null;
  vendorSignedAt: Date | null;
  countersignedAt: Date | null;
  executedAt: Date | null;
};

export function contractNumber(projectId: number, contractId: number): string {
  return `WO-${String(projectId).padStart(4, "0")}-${String(contractId).padStart(3, "0")}`;
}

/** The live contract for a project, if there is one. Voided rows are history. */
export async function readContract(projectId: number): Promise<ContractSummary | null> {
  const [row] = await db()
    .select({
      id: schema.projectContracts.id,
      status: schema.projectContracts.status,
      amount: schema.projectContracts.amount,
      vendorName: schema.vendors.name,
      createdAt: schema.projectContracts.createdAt,
      sentAt: schema.projectContracts.sentAt,
      vendorSignedAt: schema.projectContracts.vendorSignedAt,
      countersignedAt: schema.projectContracts.countersignedAt,
      executedAt: schema.projectContracts.executedAt,
    })
    .from(schema.projectContracts)
    .leftJoin(schema.bids, eq(schema.bids.id, schema.projectContracts.bidId))
    .leftJoin(schema.vendors, eq(schema.vendors.id, schema.bids.vendorId))
    .where(
      and(
        eq(schema.projectContracts.projectId, projectId),
        ne(schema.projectContracts.status, "voided"),
      ),
    )
    .orderBy(desc(schema.projectContracts.id))
    .limit(1);

  if (!row) return null;
  return {
    id: row.id,
    status: row.status as ContractStatus,
    amount: Number(row.amount),
    vendorName: row.vendorName,
    contractNumber: contractNumber(projectId, row.id),
    createdAt: row.createdAt,
    sentAt: row.sentAt,
    vendorSignedAt: row.vendorSignedAt,
    countersignedAt: row.countersignedAt,
    executedAt: row.executedAt,
  };
}

export type GenerateResult = { ok: true; contractId: number } | { ok: false; error: string };

/**
 * Generate the contract for the awarded bid.
 *
 * Refuses if one is already live: reissuing means voiding the old one first, so
 * there is always exactly one document that counts and the reason for a second
 * attempt is on the record.
 */
export async function generateContractRow(projectId: number): Promise<GenerateResult> {
  const existing = await readContract(projectId);
  if (existing) {
    return { ok: false, error: "This project already has a contract. Void it to issue a new one." };
  }

  const bid = await db().query.bids.findFirst({
    where: and(
      eq(schema.bids.projectId, projectId),
      eq(schema.bids.approved, true),
      isNull(schema.bids.archivedAt),
    ),
    columns: { id: true, source: true, awardReason: true },
  });
  if (!bid) return { ok: false, error: "Select a winning bid before generating a contract" };

  const [{ total }] = await db()
    .select({ total: sql<number>`coalesce(sum(${schema.bidLineItems.amount}), 0)::float8` })
    .from(schema.bidLineItems)
    .where(eq(schema.bidLineItems.bidId, bid.id));
  if (total <= 0) return { ok: false, error: "The winning bid has no priced lines" };

  const template = await db().query.contractTemplates.findFirst({
    where: and(
      eq(schema.contractTemplates.isDefault, true),
      isNull(schema.contractTemplates.archivedAt),
    ),
  });
  if (!template) {
    return { ok: false, error: "No default contract template. Set one up in Settings first." };
  }

  const ctx = await readContractContext(projectId, bid.id);
  if (!ctx) return { ok: false, error: "Project not found" };

  const body = fillTemplate(template.body, {
    company: COMPANY,
    vendor: ctx.vendorName,
    property: ctx.propertyName,
    project: ctx.projectName,
    amount: `$${total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    date: new Date().toISOString().slice(0, 10),
  });

  const [row] = await db()
    .insert(schema.projectContracts)
    .values({
      projectId,
      bidId: bid.id,
      templateId: template.id,
      status: "draft",
      bodySnapshot: body,
      amount: total.toFixed(2),
    })
    .returning({ id: schema.projectContracts.id });

  return { ok: true, contractId: row.id };
}

type ContractContext = {
  propertyName: string;
  projectName: string;
  vendorName: string;
  vendorContact: string | null;
  lines: ContractLine[];
  linesArePriced: boolean;
  awardNote: string | null;
};

async function readContractContext(
  projectId: number,
  bidId: number,
): Promise<ContractContext | null> {
  const project = await db().query.projects.findFirst({
    where: eq(schema.projects.id, projectId),
    columns: { name: true, propertyId: true },
  });
  if (!project) return null;

  const [property, bid, lines] = await Promise.all([
    db().query.properties.findFirst({
      where: eq(schema.properties.id, project.propertyId),
      columns: { name: true },
    }),
    db().query.bids.findFirst({
      where: eq(schema.bids.id, bidId),
      columns: { vendorId: true, source: true, awardReason: true },
    }),
    db()
      .select({
        description: schema.bidLineItems.description,
        amount: schema.bidLineItems.amount,
        costCode: schema.costCodes.name,
      })
      .from(schema.bidLineItems)
      .leftJoin(schema.scopeItems, eq(schema.scopeItems.id, schema.bidLineItems.scopeItemId))
      .leftJoin(schema.costCodes, eq(schema.costCodes.id, schema.scopeItems.costCodeId))
      .where(eq(schema.bidLineItems.bidId, bidId))
      .orderBy(asc(schema.bidLineItems.sortOrder), asc(schema.bidLineItems.id)),
  ]);

  const vendor = bid?.vendorId
    ? await db().query.vendors.findFirst({
        where: eq(schema.vendors.id, bid.vendorId),
        columns: { name: true },
      })
    : null;

  const contact = bid?.vendorId
    ? await db().query.vendorContacts.findFirst({
        where: and(
          eq(schema.vendorContacts.vendorId, bid.vendorId),
          eq(schema.vendorContacts.active, true),
        ),
        columns: { name: true, email: true },
      })
    : null;

  // A direct award carries one agreed number on the first line, so per-line
  // amounts would be fiction. Every line priced above zero means the vendor
  // actually broke it down.
  const priced = lines.filter((l) => Number(l.amount) > 0).length;
  const linesArePriced = lines.length > 0 && priced === lines.length;

  return {
    propertyName: property?.name ?? "—",
    projectName: project.name,
    vendorName: vendor?.name ?? "Unnamed vendor",
    vendorContact: contact ? [contact.name, contact.email].filter(Boolean).join(" · ") : null,
    lines: lines.map((l, i) => ({
      index: i + 1,
      item: l.description,
      costCode: l.costCode,
      amount: Number(l.amount),
    })),
    linesArePriced,
    awardNote:
      bid?.source === "direct" && bid.awardReason
        ? `Assigned directly without competitive bid — ${bid.awardReason}`
        : null,
  };
}

/**
 * Everything the PDF needs, read off the snapshot.
 *
 * The terms come from body_snapshot, never from the template: editing the
 * template must not change a document that has been sent or signed.
 */
export async function readContractDocument(contractId: number): Promise<ContractData | null> {
  const row = await db().query.projectContracts.findFirst({
    where: eq(schema.projectContracts.id, contractId),
  });
  if (!row) return null;

  const ctx = await readContractContext(row.projectId, row.bidId);
  if (!ctx) return null;

  return {
    company: COMPANY,
    propertyName: ctx.propertyName,
    projectName: ctx.projectName,
    vendorName: ctx.vendorName,
    vendorContact: ctx.vendorContact,
    body: row.bodySnapshot,
    lines: ctx.lines,
    amount: Number(row.amount),
    linesArePriced: ctx.linesArePriced,
    contractNumber: contractNumber(row.projectId, row.id),
    dateLabel: (row.executedAt ?? row.sentAt ?? row.createdAt).toISOString().slice(0, 10),
    awardNote: ctx.awardNote,
    draft: row.status !== "executed",
  };
}

export type StepResult = { ok: true } | { ok: false; error: string };

/**
 * Move a contract along.
 *
 * The transitions are explicit rather than "set status to whatever the caller
 * says", because the dates and the status have to agree — a row claiming
 * executed with no executed_at is a gate met by nothing, and the database
 * refuses it anyway.
 */
export async function advanceContractRow(
  projectId: number,
  contractId: number,
  to: "out_for_signature" | "vendor_signed" | "executed" | "voided",
): Promise<StepResult> {
  const row = await db().query.projectContracts.findFirst({
    where: eq(schema.projectContracts.id, contractId),
    columns: { id: true, projectId: true, status: true, vendorSignedAt: true },
  });
  if (!row) return { ok: false, error: "Contract not found" };
  // The caller names both, and they have to agree. Without this a contract id
  // from another project would be executed and stamped while the cache
  // revalidation fired for the project that was named.
  if (row.projectId !== projectId) return { ok: false, error: "Contract not found" };
  if (row.status === "executed" && to !== "voided") {
    return { ok: false, error: "This contract is already executed" };
  }
  if (row.status === "voided") return { ok: false, error: "This contract was voided" };

  const now = new Date();
  const set: Record<string, unknown> = { status: to };
  if (to === "out_for_signature") set.sentAt = now;
  if (to === "vendor_signed") set.vendorSignedAt = now;
  if (to === "executed") {
    set.executedAt = now;
    set.countersignedAt = now;
    // Both parties sign. If the vendor's signature was never recorded, stamp it
    // now rather than leaving executed with a hole where half the agreement is.
    if (!row.vendorSignedAt) set.vendorSignedAt = now;
  }

  await db().transaction(async (tx) => {
    await tx
      .update(schema.projectContracts)
      .set(set)
      .where(eq(schema.projectContracts.id, contractId));

    // The gate reads projects.contract_signed_at, so executing has to stamp it
    // in the same transaction — otherwise the contract says signed and the
    // phase strip disagrees.
    if (to === "executed") {
      await tx
        .update(schema.projects)
        .set({ contractSignedAt: now.toISOString().slice(0, 10) })
        .where(eq(schema.projects.id, row.projectId));
    }
    if (to === "voided") {
      await tx
        .update(schema.projects)
        .set({ contractSignedAt: null })
        .where(eq(schema.projects.id, row.projectId));
    }
  });

  return { ok: true };
}

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { ActionResult } from "@/lib/action-result";
import { uncoveredLineIds } from "@/lib/award-coverage";
import { directAwardRows, type DirectAwardResult } from "@/lib/scope-confirm";
import type { InlinePricingMethod, PricingMethod } from "@/lib/pricing";

// ---------------------------------------------------------------------------
// Vendor rate agreements — a vendor's standing per-cost-code price sheet
// against one renovation tier, so a unit turned to that tier can be awarded
// with one confirmation instead of a fresh competitive bid each time. Plain
// functions (not "use server" actions) so they can be exercised without a
// request, same split as scope-confirm.ts.
//
// Server-only (imports db()) — client components needing INLINE_PRICING_METHODS
// or InlinePricingMethod must import those from @/lib/pricing instead.
// ---------------------------------------------------------------------------

export type AgreementLineRow = {
  id: number;
  costCodeId: number;
  pricingMethod: PricingMethod;
  unitPrice: number;
  defaultQuantity: number | null;
  notes: string | null;
};

export type AgreementSummary = {
  id: number;
  vendorId: number;
  vendorName: string;
  name: string | null;
  status: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  lines: AgreementLineRow[];
};

async function propertyChartId(propertyId: number): Promise<number | null> {
  const property = await db().query.properties.findFirst({
    where: eq(schema.properties.id, propertyId),
    columns: { chartOfAccountsId: true },
  });
  return property?.chartOfAccountsId ?? null;
}

async function validateCode(propertyId: number, costCodeId: number): Promise<boolean> {
  const chartId = await propertyChartId(propertyId);
  if (chartId == null) return false;
  const code = await db().query.costCodes.findFirst({
    where: eq(schema.costCodes.id, costCodeId),
    columns: { chartId: true },
  });
  return !!code && code.chartId === chartId;
}

/** Every agreement (any status) on a tier, for the renovation-type page. */
export async function listAgreementsForGroup(budgetGroupId: number): Promise<AgreementSummary[]> {
  const agreements = await db()
    .select({
      id: schema.vendorRateAgreements.id,
      vendorId: schema.vendorRateAgreements.vendorId,
      vendorName: schema.vendors.name,
      name: schema.vendorRateAgreements.name,
      status: schema.vendorRateAgreements.status,
      effectiveFrom: schema.vendorRateAgreements.effectiveFrom,
      effectiveTo: schema.vendorRateAgreements.effectiveTo,
    })
    .from(schema.vendorRateAgreements)
    .innerJoin(schema.vendors, eq(schema.vendors.id, schema.vendorRateAgreements.vendorId))
    .where(
      and(
        eq(schema.vendorRateAgreements.budgetGroupId, budgetGroupId),
        isNull(schema.vendorRateAgreements.archivedAt),
      ),
    )
    .orderBy(asc(schema.vendorRateAgreements.createdAt));
  if (agreements.length === 0) return [];

  const lines = await db()
    .select()
    .from(schema.vendorRateAgreementLines)
    .where(inArray(schema.vendorRateAgreementLines.agreementId, agreements.map((a) => a.id)))
    .orderBy(asc(schema.vendorRateAgreementLines.sortOrder));
  const linesByAgreement = new Map<number, AgreementLineRow[]>();
  for (const ln of lines) {
    const list = linesByAgreement.get(ln.agreementId) ?? [];
    list.push({
      id: ln.id,
      costCodeId: ln.costCodeId,
      pricingMethod: ln.pricingMethod,
      unitPrice: Number(ln.unitPrice),
      defaultQuantity: ln.defaultQuantity != null ? Number(ln.defaultQuantity) : null,
      notes: ln.notes,
    });
    linesByAgreement.set(ln.agreementId, list);
  }

  return agreements.map((a) => ({ ...a, lines: linesByAgreement.get(a.id) ?? [] }));
}

/** Active, not-yet-expired agreements matching a project's own tier. Empty
 *  for anything that isn't a unit turn — common-area projects carry no tier. */
export async function listActiveAgreementsForProject(
  projectId: number,
): Promise<{ id: number; vendorId: number; vendorName: string }[]> {
  const project = await db().query.projects.findFirst({
    where: eq(schema.projects.id, projectId),
    columns: { kind: true, budgetGroupId: true },
  });
  if (!project || project.kind !== "unit" || project.budgetGroupId == null) return [];

  const today = new Date().toISOString().slice(0, 10);
  return db()
    .select({
      id: schema.vendorRateAgreements.id,
      vendorId: schema.vendorRateAgreements.vendorId,
      vendorName: schema.vendors.name,
    })
    .from(schema.vendorRateAgreements)
    .innerJoin(schema.vendors, eq(schema.vendors.id, schema.vendorRateAgreements.vendorId))
    .where(
      and(
        eq(schema.vendorRateAgreements.budgetGroupId, project.budgetGroupId),
        eq(schema.vendorRateAgreements.status, "active"),
        isNull(schema.vendorRateAgreements.archivedAt),
        sql`(${schema.vendorRateAgreements.effectiveTo} is null or ${schema.vendorRateAgreements.effectiveTo} >= ${today})`,
      ),
    );
}

export type AgreementPreviewLine = {
  costCodeId: number;
  item: string;
  unitPrice: number;
  quantity: number;
  total: number;
};

export type AgreementPreview = {
  vendorId: number;
  vendorName: string;
  tierName: string;
  perLine: AgreementPreviewLine[];
  /** On this project's scope but not on the agreement, or already held by
   *  another award — still need separate handling. */
  uncoveredScopeItems: { id: number; item: string }[];
  scopeItemIds: number[];
  total: number;
};

/**
 * Price an agreement against one project's already-confirmed scope.
 *
 * Reuses the scope line's own stored quantity rather than re-deriving one
 * from unit metadata — that quantity was fixed at Confirm Scope, and an
 * agreement is repricing the same confirmed work at a different vendor's
 * rate, not re-scoping the unit from scratch. Only `fixed`/`sqft`/per-*
 * counted methods are supported this way; `percent` needs the tier's own
 * subtotal as a base and isn't priced here (see INLINE_PRICING_METHODS in pricing.ts).
 */
export async function priceAgreementForProject(
  agreementId: number,
  projectId: number,
): Promise<AgreementPreview | null> {
  const agreement = await db().query.vendorRateAgreements.findFirst({
    where: eq(schema.vendorRateAgreements.id, agreementId),
  });
  if (!agreement) return null;

  const [vendor, group, lines, scopeItems, uncovered] = await Promise.all([
    db().query.vendors.findFirst({
      where: eq(schema.vendors.id, agreement.vendorId),
      columns: { name: true },
    }),
    db().query.budgetGroups.findFirst({
      where: eq(schema.budgetGroups.id, agreement.budgetGroupId),
      columns: { name: true },
    }),
    db()
      .select()
      .from(schema.vendorRateAgreementLines)
      .where(eq(schema.vendorRateAgreementLines.agreementId, agreementId)),
    db()
      .select({
        id: schema.scopeItems.id,
        item: schema.scopeItems.item,
        costCodeId: schema.scopeItems.costCodeId,
        quantity: schema.scopeItems.quantity,
      })
      .from(schema.scopeItems)
      .where(and(eq(schema.scopeItems.projectId, projectId), isNull(schema.scopeItems.archivedAt))),
    uncoveredLineIds(projectId),
  ]);

  const lineByCode = new Map(lines.map((l) => [l.costCodeId, l]));
  const uncoveredIds = new Set(uncovered);

  const perLine: AgreementPreviewLine[] = [];
  const uncoveredScopeItems: { id: number; item: string }[] = [];
  const scopeItemIds: number[] = [];
  let total = 0;

  for (const item of scopeItems) {
    const line = item.costCodeId != null ? lineByCode.get(item.costCodeId) : undefined;
    if (!line || !uncoveredIds.has(item.id) || !item.quantity) {
      uncoveredScopeItems.push({ id: item.id, item: item.item });
      continue;
    }
    const quantity = Number(item.quantity);
    const unitPrice = Number(line.unitPrice);
    const lineTotal = Math.round(quantity * unitPrice * 100) / 100;
    perLine.push({ costCodeId: line.costCodeId, item: item.item, unitPrice, quantity, total: lineTotal });
    scopeItemIds.push(item.id);
    total += lineTotal;
  }

  return {
    vendorId: agreement.vendorId,
    vendorName: vendor?.name ?? "Vendor",
    tierName: group?.name ?? "this tier",
    perLine,
    uncoveredScopeItems,
    scopeItemIds,
    total: Math.round(total * 100) / 100,
  };
}

/** Award a project under an agreement — computes the covered lines and
 *  amount, then hands off to the exact same primitive a hand-typed direct
 *  award uses. No new bid/contract code path. */
export async function awardProjectFromAgreementRows(
  projectId: number,
  agreementId: number,
  reason: string,
): Promise<DirectAwardResult> {
  const preview = await priceAgreementForProject(agreementId, projectId);
  if (!preview) return { ok: false, error: "Rate agreement not found" };
  if (preview.scopeItemIds.length === 0) {
    return { ok: false, error: "No scope lines on this project match the agreement" };
  }
  return directAwardRows(
    projectId,
    preview.vendorId,
    preview.total.toFixed(2),
    reason,
    preview.scopeItemIds,
  );
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function createAgreementRow(input: {
  propertyId: number;
  budgetGroupId: number;
  vendorId: number;
  name?: string | null;
  seedFromTierDefaults: boolean;
}): Promise<ActionResult<{ agreementId: number }>> {
  const group = await db().query.budgetGroups.findFirst({
    where: eq(schema.budgetGroups.id, input.budgetGroupId),
    columns: { propertyId: true },
  });
  if (!group || group.propertyId !== input.propertyId) {
    return { ok: false, error: "Renovation type not found for this property" };
  }

  const vendor = await db().query.vendors.findFirst({
    where: and(eq(schema.vendors.id, input.vendorId), eq(schema.vendors.active, true)),
    columns: { id: true },
  });
  if (!vendor) return { ok: false, error: "That vendor is not active" };

  const [agreement] = await db()
    .insert(schema.vendorRateAgreements)
    .values({
      propertyId: input.propertyId,
      budgetGroupId: input.budgetGroupId,
      vendorId: input.vendorId,
      name: input.name?.trim() || null,
    })
    .returning({ id: schema.vendorRateAgreements.id });

  if (input.seedFromTierDefaults) {
    const tierLines = await db()
      .select()
      .from(schema.budgetGroupLines)
      .where(eq(schema.budgetGroupLines.budgetGroupId, input.budgetGroupId))
      .orderBy(asc(schema.budgetGroupLines.sortOrder));
    if (tierLines.length > 0) {
      await db()
        .insert(schema.vendorRateAgreementLines)
        .values(
          tierLines.map((ln, i) => ({
            agreementId: agreement.id,
            costCodeId: ln.costCodeId,
            pricingMethod: ln.pricingMethod,
            unitPrice: ln.unitPrice,
            defaultQuantity: ln.defaultQuantity,
            sortOrder: i,
          })),
        );
    }
  }

  return { ok: true, agreementId: agreement.id };
}

/** Activate a draft/ended agreement, ending whatever this vendor already had
 *  active on this tier first — the partial unique index never has to refuse. */
export async function activateAgreementRow(id: number): Promise<ActionResult> {
  const agreement = await db().query.vendorRateAgreements.findFirst({
    where: eq(schema.vendorRateAgreements.id, id),
    columns: { budgetGroupId: true, vendorId: true },
  });
  if (!agreement) return { ok: false, error: "Agreement not found" };

  await db().transaction(async (tx) => {
    await tx
      .update(schema.vendorRateAgreements)
      .set({ status: "ended" })
      .where(
        and(
          eq(schema.vendorRateAgreements.budgetGroupId, agreement.budgetGroupId),
          eq(schema.vendorRateAgreements.vendorId, agreement.vendorId),
          eq(schema.vendorRateAgreements.status, "active"),
        ),
      );
    await tx
      .update(schema.vendorRateAgreements)
      .set({ status: "active" })
      .where(eq(schema.vendorRateAgreements.id, id));
  });
  return { ok: true };
}

export async function endAgreementRow(id: number): Promise<ActionResult> {
  await db()
    .update(schema.vendorRateAgreements)
    .set({ status: "ended" })
    .where(eq(schema.vendorRateAgreements.id, id));
  return { ok: true };
}

export async function archiveAgreementRow(id: number): Promise<ActionResult> {
  await db()
    .update(schema.vendorRateAgreements)
    .set({ archivedAt: new Date() })
    .where(eq(schema.vendorRateAgreements.id, id));
  return { ok: true };
}

export async function addAgreementLineRow(input: {
  agreementId: number;
  propertyId: number;
  costCodeId: number;
}): Promise<ActionResult> {
  const agreement = await db().query.vendorRateAgreements.findFirst({
    where: eq(schema.vendorRateAgreements.id, input.agreementId),
    columns: { propertyId: true },
  });
  if (!agreement || agreement.propertyId !== input.propertyId) {
    return { ok: false, error: "Agreement not found for this property" };
  }
  if (!(await validateCode(input.propertyId, input.costCodeId))) {
    return { ok: false, error: "That cost code isn't in this property's chart" };
  }

  const [{ maxOrder }] = await db()
    .select({ maxOrder: sql<number>`coalesce(max(${schema.vendorRateAgreementLines.sortOrder}), 0)::int` })
    .from(schema.vendorRateAgreementLines)
    .where(eq(schema.vendorRateAgreementLines.agreementId, input.agreementId));

  await db()
    .insert(schema.vendorRateAgreementLines)
    .values({
      agreementId: input.agreementId,
      costCodeId: input.costCodeId,
      pricingMethod: "fixed",
      unitPrice: "0",
      sortOrder: maxOrder + 1,
    });
  return { ok: true };
}

export async function deleteAgreementLineRow(input: { id: number; propertyId: number }): Promise<ActionResult> {
  const line = await db().query.vendorRateAgreementLines.findFirst({
    where: eq(schema.vendorRateAgreementLines.id, input.id),
    columns: { id: true, agreementId: true },
  });
  if (!line) return { ok: false, error: "Line not found" };
  const agreement = await db().query.vendorRateAgreements.findFirst({
    where: eq(schema.vendorRateAgreements.id, line.agreementId),
    columns: { propertyId: true },
  });
  if (!agreement || agreement.propertyId !== input.propertyId) {
    return { ok: false, error: "Agreement not found for this property" };
  }
  await db().delete(schema.vendorRateAgreementLines).where(eq(schema.vendorRateAgreementLines.id, line.id));
  return { ok: true };
}

/** Batch-save the inline grid's amount + basis, same shape as
 *  updateTierDefaults for a renovation type's own defaults. */
export async function updateAgreementLinesRow(input: {
  agreementId: number;
  propertyId: number;
  lines: { costCodeId: number; pricingMethod: InlinePricingMethod; unitPrice: number }[];
}): Promise<ActionResult<{ updated: number }>> {
  const agreement = await db().query.vendorRateAgreements.findFirst({
    where: eq(schema.vendorRateAgreements.id, input.agreementId),
    columns: { propertyId: true },
  });
  if (!agreement || agreement.propertyId !== input.propertyId) {
    return { ok: false, error: "Agreement not found for this property" };
  }

  const existing = await db()
    .select({ id: schema.vendorRateAgreementLines.id, costCodeId: schema.vendorRateAgreementLines.costCodeId })
    .from(schema.vendorRateAgreementLines)
    .where(eq(schema.vendorRateAgreementLines.agreementId, input.agreementId));
  const idByCode = new Map(existing.map((l) => [l.costCodeId, l.id]));

  const unknown = input.lines.filter((l) => !idByCode.has(l.costCodeId));
  if (unknown.length > 0) {
    return { ok: false, error: "A line no longer exists on this agreement — reload and retry." };
  }

  await db().transaction(async (tx) => {
    for (const l of input.lines) {
      await tx
        .update(schema.vendorRateAgreementLines)
        .set({ pricingMethod: l.pricingMethod, unitPrice: l.unitPrice.toFixed(2) })
        .where(eq(schema.vendorRateAgreementLines.id, idByCode.get(l.costCodeId)!));
    }
  });
  return { ok: true, updated: input.lines.length };
}

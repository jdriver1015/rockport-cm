import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { ActionResult } from "@/lib/action-result";
import { uncoveredLineIds } from "@/lib/award-coverage";
import { directAwardRows, type DirectAwardResult } from "@/lib/scope-confirm";
import { INLINE_PRICING_METHODS, roundMoney, type InlinePricingMethod, type PricingMethod } from "@/lib/pricing";

/**
 * Postgres 23505. Walks the cause chain rather than reading `err.code`: Drizzle
 * wraps driver errors in a DrizzleQueryError and hangs the real one off `cause`,
 * so the top-level code is undefined and a check on it silently never matches.
 */
function isUniqueViolation(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e != null && depth < 5; depth++) {
    if (typeof e === "object" && "code" in e && (e as { code?: unknown }).code === "23505") {
      return true;
    }
    e = typeof e === "object" && "cause" in e ? (e as { cause?: unknown }).cause : null;
  }
  return false;
}

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
        sql`(${schema.vendorRateAgreements.effectiveFrom} is null or ${schema.vendorRateAgreements.effectiveFrom} <= ${today})`,
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

type ProjectPricingContext = {
  budgetGroupId: number;
  tierName: string;
  scopeItems: { id: number; item: string; costCodeId: number | null; quantity: string | null }[];
  uncoveredIds: Set<number>;
  /** The tier's own pricing method per cost code — see priceAgreementAgainstContext. */
  tierMethodByCode: Map<number, PricingMethod>;
};

/**
 * Everything needed to price any agreement against one project, fetched once.
 * Pricing several agreements for the same project (the Select Bid dialog,
 * when a tier has more than one active agreement) shares this instead of
 * repeating the project/scope/tier lookups per agreement.
 *
 * Null for anything that isn't a unit turn — common-area projects carry no tier.
 */
async function loadProjectPricingContext(projectId: number): Promise<ProjectPricingContext | null> {
  const project = await db().query.projects.findFirst({
    where: eq(schema.projects.id, projectId),
    columns: { kind: true, budgetGroupId: true },
  });
  if (!project || project.kind !== "unit" || project.budgetGroupId == null) return null;

  const [group, tierLines, scopeItems, uncovered] = await Promise.all([
    db().query.budgetGroups.findFirst({
      where: eq(schema.budgetGroups.id, project.budgetGroupId),
      columns: { name: true },
    }),
    db()
      .select({
        costCodeId: schema.budgetGroupLines.costCodeId,
        pricingMethod: schema.budgetGroupLines.pricingMethod,
      })
      .from(schema.budgetGroupLines)
      .where(eq(schema.budgetGroupLines.budgetGroupId, project.budgetGroupId)),
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

  return {
    budgetGroupId: project.budgetGroupId,
    tierName: group?.name ?? "this tier",
    scopeItems,
    uncoveredIds: new Set(uncovered),
    tierMethodByCode: new Map(tierLines.map((l) => [l.costCodeId, l.pricingMethod])),
  };
}

/**
 * Price one agreement's lines against an already-loaded project context.
 *
 * Reuses the scope line's own stored quantity rather than re-deriving one
 * from unit metadata — that quantity was fixed at Confirm Scope, and an
 * agreement is repricing the same confirmed work at a different vendor's
 * rate, not re-scoping the unit from scratch. Only `fixed`/`sqft`/per-*
 * counted methods are supported this way; `percent` needs the tier's own
 * subtotal as a base and isn't priced here (see INLINE_PRICING_METHODS in
 * pricing.ts).
 *
 * An agreement line priced on a different basis than the tier's own default
 * for that cost code can't safely reuse the scope item's stored quantity —
 * that quantity was derived under the tier's method, so pricing it under a
 * mismatched method would silently produce a wrong dollar amount. Such lines
 * are left uncovered rather than guessed at.
 *
 * Returns null when the agreement's tier doesn't match this project's own —
 * repricing under an unrelated tier's agreement isn't meaningful.
 */
function priceAgreementAgainstContext(
  agreement: { vendorId: number; budgetGroupId: number },
  vendorName: string,
  lines: { costCodeId: number; pricingMethod: PricingMethod; unitPrice: string }[],
  ctx: ProjectPricingContext,
): AgreementPreview | null {
  if (agreement.budgetGroupId !== ctx.budgetGroupId) return null;

  const lineByCode = new Map(lines.map((l) => [l.costCodeId, l]));
  const perLine: AgreementPreviewLine[] = [];
  const uncoveredScopeItems: { id: number; item: string }[] = [];
  const scopeItemIds: number[] = [];
  let total = 0;

  for (const item of ctx.scopeItems) {
    const line = item.costCodeId != null ? lineByCode.get(item.costCodeId) : undefined;
    const tierMethod = item.costCodeId != null ? ctx.tierMethodByCode.get(item.costCodeId) : undefined;
    const methodMatches = !line || tierMethod === undefined || line.pricingMethod === tierMethod;
    if (!line || !ctx.uncoveredIds.has(item.id) || !item.quantity || !methodMatches) {
      uncoveredScopeItems.push({ id: item.id, item: item.item });
      continue;
    }
    const quantity = Number(item.quantity);
    const unitPrice = Number(line.unitPrice);
    const lineTotal = roundMoney(quantity * unitPrice);
    perLine.push({ costCodeId: line.costCodeId, item: item.item, unitPrice, quantity, total: lineTotal });
    scopeItemIds.push(item.id);
    total += lineTotal;
  }

  return {
    vendorId: agreement.vendorId,
    vendorName,
    tierName: ctx.tierName,
    perLine,
    uncoveredScopeItems,
    scopeItemIds,
    total: roundMoney(total),
  };
}

/** Price one agreement against one project's already-confirmed scope. */
export async function priceAgreementForProject(
  agreementId: number,
  projectId: number,
): Promise<AgreementPreview | null> {
  const [agreement, ctx] = await Promise.all([
    db().query.vendorRateAgreements.findFirst({ where: eq(schema.vendorRateAgreements.id, agreementId) }),
    loadProjectPricingContext(projectId),
  ]);
  if (!agreement || !ctx) return null;

  const [vendor, lines] = await Promise.all([
    db().query.vendors.findFirst({
      where: eq(schema.vendors.id, agreement.vendorId),
      columns: { name: true },
    }),
    db()
      .select()
      .from(schema.vendorRateAgreementLines)
      .where(eq(schema.vendorRateAgreementLines.agreementId, agreementId)),
  ]);

  return priceAgreementAgainstContext(agreement, vendor?.name ?? "Vendor", lines, ctx);
}

/** Price several agreements against the same project in one pass, sharing the
 *  project/scope/tier lookups instead of repeating them per agreement — for
 *  the Select Bid dialog, where a tier can have more than one active agreement. */
export async function priceAgreementsForProject(
  agreementIds: number[],
  projectId: number,
): Promise<Map<number, AgreementPreview>> {
  const result = new Map<number, AgreementPreview>();
  if (agreementIds.length === 0) return result;

  const ctx = await loadProjectPricingContext(projectId);
  if (!ctx) return result;

  const agreements = await db()
    .select({
      id: schema.vendorRateAgreements.id,
      vendorId: schema.vendorRateAgreements.vendorId,
      vendorName: schema.vendors.name,
      budgetGroupId: schema.vendorRateAgreements.budgetGroupId,
    })
    .from(schema.vendorRateAgreements)
    .innerJoin(schema.vendors, eq(schema.vendors.id, schema.vendorRateAgreements.vendorId))
    .where(inArray(schema.vendorRateAgreements.id, agreementIds));
  if (agreements.length === 0) return result;

  const lines = await db()
    .select()
    .from(schema.vendorRateAgreementLines)
    .where(inArray(schema.vendorRateAgreementLines.agreementId, agreements.map((a) => a.id)));
  const linesByAgreement = new Map<number, typeof lines>();
  for (const l of lines) {
    const list = linesByAgreement.get(l.agreementId) ?? [];
    list.push(l);
    linesByAgreement.set(l.agreementId, list);
  }

  for (const a of agreements) {
    const preview = priceAgreementAgainstContext(a, a.vendorName, linesByAgreement.get(a.id) ?? [], ctx);
    if (preview) result.set(a.id, preview);
  }
  return result;
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
  if (!preview) return { ok: false, error: "Rate agreement not found for this project's tier" };
  if (preview.scopeItemIds.length === 0) {
    return { ok: false, error: "No scope lines on this project match the agreement" };
  }
  if (preview.total <= 0) {
    return { ok: false, error: "This agreement prices to $0 for this unit — nothing to award" };
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

  const agreementId = await db().transaction(async (tx) => {
    const [agreement] = await tx
      .insert(schema.vendorRateAgreements)
      .values({
        propertyId: input.propertyId,
        budgetGroupId: input.budgetGroupId,
        vendorId: input.vendorId,
        name: input.name?.trim() || null,
      })
      .returning({ id: schema.vendorRateAgreements.id });

    if (input.seedFromTierDefaults) {
      const tierLines = await tx
        .select()
        .from(schema.budgetGroupLines)
        .where(eq(schema.budgetGroupLines.budgetGroupId, input.budgetGroupId))
        .orderBy(asc(schema.budgetGroupLines.sortOrder));
      if (tierLines.length > 0) {
        await tx.insert(schema.vendorRateAgreementLines).values(
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

    return agreement.id;
  });

  return { ok: true, agreementId };
}

async function findOwnedAgreement(
  id: number,
  propertyId: number,
): Promise<{ budgetGroupId: number; vendorId: number } | null> {
  const agreement = await db().query.vendorRateAgreements.findFirst({
    where: eq(schema.vendorRateAgreements.id, id),
    columns: { propertyId: true, budgetGroupId: true, vendorId: true },
  });
  if (!agreement || agreement.propertyId !== propertyId) return null;
  return agreement;
}

/** Activate a draft/ended agreement, ending whatever this vendor already had
 *  active on this tier first — the partial unique index never has to refuse.
 *  A concurrent activation can still race it, so the transaction is also
 *  guarded against the unique-violation that races into. */
export async function activateAgreementRow(id: number, propertyId: number): Promise<ActionResult> {
  const agreement = await findOwnedAgreement(id, propertyId);
  if (!agreement) return { ok: false, error: "Agreement not found for this property" };

  try {
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
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { ok: false, error: "Another agreement for this vendor was just activated — reload and retry" };
    }
    throw err;
  }
  return { ok: true };
}

export async function endAgreementRow(id: number, propertyId: number): Promise<ActionResult> {
  const agreement = await findOwnedAgreement(id, propertyId);
  if (!agreement) return { ok: false, error: "Agreement not found for this property" };
  await db()
    .update(schema.vendorRateAgreements)
    .set({ status: "ended" })
    .where(eq(schema.vendorRateAgreements.id, id));
  return { ok: true };
}

export async function archiveAgreementRow(id: number, propertyId: number): Promise<ActionResult> {
  const agreement = await findOwnedAgreement(id, propertyId);
  if (!agreement) return { ok: false, error: "Agreement not found for this property" };
  await db()
    .update(schema.vendorRateAgreements)
    .set({ archivedAt: new Date() })
    .where(eq(schema.vendorRateAgreements.id, id));
  return { ok: true };
}

export async function restoreAgreementRow(id: number, propertyId: number): Promise<ActionResult> {
  const agreement = await findOwnedAgreement(id, propertyId);
  if (!agreement) return { ok: false, error: "Agreement not found for this property" };
  await db()
    .update(schema.vendorRateAgreements)
    .set({ archivedAt: null })
    .where(eq(schema.vendorRateAgreements.id, id));
  return { ok: true };
}

export type ArchivedAgreementSummary = {
  id: number;
  vendorName: string;
  name: string | null;
  archivedAt: Date;
};

/** Removed agreements on a tier, for the "Show archived" disclosure. */
export async function listArchivedAgreementsForGroup(
  budgetGroupId: number,
): Promise<ArchivedAgreementSummary[]> {
  const rows = await db()
    .select({
      id: schema.vendorRateAgreements.id,
      vendorName: schema.vendors.name,
      name: schema.vendorRateAgreements.name,
      archivedAt: schema.vendorRateAgreements.archivedAt,
    })
    .from(schema.vendorRateAgreements)
    .innerJoin(schema.vendors, eq(schema.vendors.id, schema.vendorRateAgreements.vendorId))
    .where(
      and(
        eq(schema.vendorRateAgreements.budgetGroupId, budgetGroupId),
        isNotNull(schema.vendorRateAgreements.archivedAt),
      ),
    )
    .orderBy(desc(schema.vendorRateAgreements.archivedAt));
  return rows.map((r) => ({ ...r, archivedAt: r.archivedAt! }));
}

export async function addAgreementLineRow(input: {
  agreementId: number;
  propertyId: number;
  costCodeId: number;
}): Promise<ActionResult> {
  const agreement = await db().query.vendorRateAgreements.findFirst({
    where: eq(schema.vendorRateAgreements.id, input.agreementId),
    columns: { propertyId: true, budgetGroupId: true },
  });
  if (!agreement || agreement.propertyId !== input.propertyId) {
    return { ok: false, error: "Agreement not found for this property" };
  }
  if (!(await validateCode(input.propertyId, input.costCodeId))) {
    return { ok: false, error: "That cost code isn't in this property's chart" };
  }

  // Default the new line to the tier's own basis for this cost code when
  // that basis is one the inline grid can actually edit — a mismatched basis
  // can't reuse the scope item's stored quantity when this agreement is
  // priced (see priceAgreementAgainstContext), so seeding it correctly up
  // front avoids handing back a line that silently prices to nothing. A tier
  // basis outside fixed/sqft is left as the "fixed" default instead, since
  // the grid can't edit percent/formula lines here anyway.
  const [{ maxOrder }, tierLine] = await Promise.all([
    db()
      .select({ maxOrder: sql<number>`coalesce(max(${schema.vendorRateAgreementLines.sortOrder}), 0)::int` })
      .from(schema.vendorRateAgreementLines)
      .where(eq(schema.vendorRateAgreementLines.agreementId, input.agreementId))
      .then(([row]) => row),
    db().query.budgetGroupLines.findFirst({
      where: and(
        eq(schema.budgetGroupLines.budgetGroupId, agreement.budgetGroupId),
        eq(schema.budgetGroupLines.costCodeId, input.costCodeId),
      ),
      columns: { pricingMethod: true },
    }),
  ]);
  const inlineTierMethod = (INLINE_PRICING_METHODS as readonly string[]).includes(tierLine?.pricingMethod ?? "")
    ? (tierLine!.pricingMethod as InlinePricingMethod)
    : "fixed";

  await db()
    .insert(schema.vendorRateAgreementLines)
    .values({
      agreementId: input.agreementId,
      costCodeId: input.costCodeId,
      pricingMethod: inlineTierMethod,
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

/**
 * Loads the Aston construction tracker workbook into a SEPARATE property, so
 * the existing Aston Post Oak record is left completely untouched.
 *
 * Reads the JSON produced by scripts/extract-aston-tracker.py — see that file
 * for why extraction is a separate stage.
 *
 * Idempotent: drops and recreates the tracker property on every run, so the
 * mapping can be tuned freely. It only ever touches TRACKER_SLUG.
 *
 * Adjustments made to fit the schema, all deliberate:
 *  - The workbook plans fractional units per tier (157.5, 54.6, 67.5, 23.4).
 *    plannedUnits is a whole count, so these are rounded with the total held
 *    at the stated 392.
 *  - Its tiers already encode bedroom count (Enhanced 1bd / 2bd) where this app
 *    splits that into tier x floorplan. The six tiers load verbatim rather than
 *    being collapsed, which would invent an allocation the sheet never states.
 *  - The rent roll covers 89 of 392 units, so no floorplan/tier plan is seeded.
 *    That is the "Plan units" step, and inferring it from under a quarter of the
 *    property would be fiction.
 *  - Interior scope names map to chart codes explicitly (INTERIOR_SCOPE_CODE)
 *    because nothing matches on text, and a fuzzy guess would put real money on
 *    the wrong cost code silently.
 *
 *   python scripts/extract-aston-tracker.py <workbook.xlsx> <out.json>
 *   npx tsx scripts/load-aston-tracker.ts <out.json>
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { readFileSync } from "node:fs";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "../src/db";
import { previewBudgetImportForChart, applyBudgetImport } from "../src/lib/property-budget-import";
import { defaultMilestoneRows } from "../src/lib/milestones";

const TRACKER_NAME = "Aston Post Oak (Tracker)";
const TRACKER_SLUG = "aston-post-oak-tracker";
const CHART_ID = 2; // Rockport default — its categories came from this workbook.

type Extract = {
  capex: {
    item: string; amount: number; awardedVendor: string | null;
    task: string | null; priority: string | null; status: string | null;
    update: string | null; bids: number[];
  }[];
  tiers: { name: string; plannedUnitsRaw: number; perUnitTotal: number; lines: { scope: string; price: number }[] }[];
  turnActuals: { scope: string; price: number; tier: string }[];
  turns: {
    floorplan: string; unitNumber: string; start: string | null; complete: string | null;
    status: string | null; previousRent: number | null; tradeOutRent: number | null;
  }[];
  rentRoll: {
    asOfDate: string;
    units: {
      unitNumber: string; floorPlanCode: string | null; sqft: number | null;
      beds: number | null; baths: number | null; renovated: boolean;
      occupancy: string | null; marketRent: number | null; inPlaceRent: number | null;
    }[];
  };
};

/** Two names exist as BOTH a non-interior and an interior code, so matching on
 *  text alone is ambiguous. This sheet is the non-interior budget. */
const NON_INTERIOR_CODE: Record<string, string> = {
  "tech package": "1900-0002",
  "general conditions": "3100-0001",
};

/**
 * The workbook names interior scopes descriptively ("Interior Paint w/ Color
 * Change - Renovation"); the chart names them as the priced item ("Full paint &
 * color change"). Stated explicitly rather than fuzzy-matched.
 *
 * Two entries are estimates, reported at the end of the run:
 *  - Interior Appliances -> Basic SS Appliances (a Designer variant also exists
 *    and the sheet does not say which).
 *  - Unit Cabinets (Paint or New Fronts) -> Paint Cabinets, the first of the two
 *    options its own name offers.
 */
const INTERIOR_SCOPE_CODE: Record<string, string> = {
  "interior paint w/ color change  - renovation": "4200-0001",
  "interior paint w/ color change": "4200-0001",
  "vinyl with take up - renovation": "4100-0002",
  "vinyl with take up": "4100-0002",
  "interior appliances - renovations": "4000-0002",
  "interior appliances": "4000-0002",
  "interior countertops (2cm) - renovation": "4000-0006",
  "interior countertops (2cm)": "4000-0006",
  "interior carpet- renovation": "4100-0001",
  "interior carpet": "4100-0001",
  "unit cabinets (paint or new fronts) - renovation": "4000-0008",
  "unit cabinets (paint or new fronts)": "4000-0008",
  "interior backsplash - renovation": "4000-0004",
  "interior backsplash": "4000-0004",
  "interior mirrors - renovation": "4000-0012",
  "interior mirrors": "4000-0012",
  "interior hardware package (pulls included) - renovation": "4000-0014",
  "interior hardware package (pulls included)": "4000-0014",
  "plumbing fixtures": "4000-0015",
  "cabinet/mud room/drop zone": "4300-0001",
  "interior labor - renovation": "4300-0008",
  "interior labor": "4300-0008",
  "interior cleaning - renovation": "4300-0007",
  "interior cleaning": "4300-0007",
  "interior fixtures - renovation": "4300-0009",
  "interior fixtures": "4300-0009",
  "cm/supervision": "4400-0001",
  contingency: "4400-0002",
};

const ESTIMATED = ["Interior Appliances -> Basic SS Appliances", "Unit Cabinets -> Paint Cabinets"];

const OCCUPANCY: Record<string, "occupied" | "notice" | "vacant" | "future"> = {
  occupied: "occupied",
  renewal: "occupied",
  "notice to vacate": "notice",
  vacant: "vacant",
};

async function teardown() {
  const existing = await db().query.properties.findFirst({
    where: eq(schema.properties.slug, TRACKER_SLUG),
  });
  if (!existing) return;
  if (existing.slug !== TRACKER_SLUG) throw new Error("guard failed");
  const P = existing.id;

  const projs = await db().select({ id: schema.projects.id }).from(schema.projects).where(eq(schema.projects.propertyId, P));
  const pids = projs.map((p) => p.id);
  if (pids.length > 0) {
    await db().delete(schema.scopeItems).where(inArray(schema.scopeItems.projectId, pids));
    await db().delete(schema.projectMilestones).where(inArray(schema.projectMilestones.projectId, pids));
    await db().delete(schema.projectStageEvents).where(inArray(schema.projectStageEvents.projectId, pids));
    await db().delete(schema.projectTriggerAnswers).where(inArray(schema.projectTriggerAnswers.projectId, pids));
    await db().delete(schema.projectActivityLog).where(inArray(schema.projectActivityLog.projectId, pids));
  }
  await db().delete(schema.glTransactions).where(eq(schema.glTransactions.propertyId, P));
  await db().delete(schema.projects).where(eq(schema.projects.propertyId, P));

  const groups = await db().select({ id: schema.budgetGroups.id }).from(schema.budgetGroups).where(eq(schema.budgetGroups.propertyId, P));
  if (groups.length > 0) {
    await db().delete(schema.budgetGroupLines).where(inArray(schema.budgetGroupLines.budgetGroupId, groups.map((g) => g.id)));
  }
  await db().delete(schema.interiorBudgetPlan).where(eq(schema.interiorBudgetPlan.propertyId, P));
  await db().delete(schema.interiorUnitGroupFloorplans).where(eq(schema.interiorUnitGroupFloorplans.propertyId, P));
  await db().delete(schema.interiorUnitGroups).where(eq(schema.interiorUnitGroups.propertyId, P));
  await db().delete(schema.budgetGroups).where(eq(schema.budgetGroups.propertyId, P));
  await db().delete(schema.interiorBudgetSettings).where(eq(schema.interiorBudgetSettings.propertyId, P));
  await db().delete(schema.budgetLines).where(eq(schema.budgetLines.propertyId, P));

  const batches = await db().select({ id: schema.rentRollBatches.id }).from(schema.rentRollBatches).where(eq(schema.rentRollBatches.propertyId, P));
  await db().delete(schema.rentRollUnits).where(eq(schema.rentRollUnits.propertyId, P));
  if (batches.length > 0) {
    await db().delete(schema.rentRollBatches).where(inArray(schema.rentRollBatches.id, batches.map((b) => b.id)));
  }
  await db().delete(schema.units).where(eq(schema.units.propertyId, P));
  await db().delete(schema.properties).where(eq(schema.properties.id, P));
  console.log(`torn down previous ${TRACKER_SLUG} (id ${P})`);
}

async function main() {
  const d: Extract = JSON.parse(readFileSync(process.argv[2], "utf-8"));
  const notes: string[] = [];

  await teardown();

  const [property] = await db()
    .insert(schema.properties)
    .values({
      name: TRACKER_NAME, slug: TRACKER_SLUG, entity: "Aston at Post Oak",
      city: "Houston", state: "TX", unitCount: 392, pmSystem: "Yardi",
      chartOfAccountsId: CHART_ID,
    })
    .returning();
  console.log(`\ncreated property ${property.id} (${property.slug})`);

  // The workbook books $4,528.55 of real cost to "Interior Fixtures" on the one
  // in-flight turn, and the chart has no such code — the nearest, Plumbing
  // Fixtures, is already carrying its own separate line on that same unit. So
  // the code is added rather than the money being dropped or mis-posted.
  // Additive and idempotent: it joins the shared Rockport chart as one more
  // available interior code and changes nothing that already exists.
  const FIXTURES_CODE = "4300-0009";
  const existingFixtures = await db().query.costCodes.findFirst({
    where: and(eq(schema.costCodes.chartId, CHART_ID), eq(schema.costCodes.code, FIXTURES_CODE)),
  });
  if (!existingFixtures) {
    const sibling = await db().query.costCodes.findFirst({
      where: and(eq(schema.costCodes.chartId, CHART_ID), eq(schema.costCodes.code, "4300-0008")),
    });
    if (sibling) {
      await db().insert(schema.costCodes).values({
        chartId: CHART_ID, categoryId: sibling.categoryId, code: FIXTURES_CODE,
        name: "Interior Fixtures", isInterior: true,
      });
      console.log(`   + added cost code ${FIXTURES_CODE} "Interior Fixtures" to the chart`);
    }
  }

  const codes = await db()
    .select({ id: schema.costCodes.id, name: schema.costCodes.name, code: schema.costCodes.code })
    .from(schema.costCodes)
    .where(and(eq(schema.costCodes.chartId, CHART_ID), eq(schema.costCodes.active, true)));
  const byCode = new Map(codes.map((c) => [c.code.trim(), c]));

  // ---- 1. non-interior budget ---------------------------------------------
  const rows = d.capex.map((c) => ({
    item: c.item, amount: c.amount,
    code: NON_INTERIOR_CODE[c.item.toLowerCase()] ?? null,
    category: null, notes: null,
  }));
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const preview = await previewBudgetImportForChart(CHART_ID, rows);
  if (preview.matched.length > 0) await applyBudgetImport(db(), property.id, preview.matched);
  console.log(`\n1. non-interior budget  ${preview.matched.length}/${rows.length} lines, $${total.toLocaleString()}`);
  for (const u of preview.unresolved) {
    notes.push(`budget line "${u.item}" ($${u.amount.toLocaleString()}) has no cost code in the chart — skipped`);
  }

  // ---- 2. renovation types -------------------------------------------------
  // Fractional plan counts rounded to whole units, holding the stated 392.
  const PLANNED = [68, 21, 157, 55, 68, 23];
  console.log(`\n2. renovation types`);
  const tierByName = new Map<string, number>();
  for (let i = 0; i < d.tiers.length; i++) {
    const t = d.tiers[i];
    const [group] = await db()
      .insert(schema.budgetGroups)
      .values({
        propertyId: property.id, name: t.name, sortOrder: i,
        description: `From the tracker workbook — ${t.plannedUnitsRaw} units planned, $${t.perUnitTotal.toFixed(2)}/unit`,
      })
      .returning({ id: schema.budgetGroups.id });
    tierByName.set(t.name, group.id);

    let sum = 0;
    let n = 0;
    for (const ln of t.lines) {
      const mapped = INTERIOR_SCOPE_CODE[ln.scope.toLowerCase()];
      const code = mapped ? byCode.get(mapped) : undefined;
      if (!code) { notes.push(`tier "${t.name}" scope "${ln.scope}" ($${ln.price}) has no chart code — skipped`); continue; }
      await db().insert(schema.budgetGroupLines).values({
        budgetGroupId: group.id, costCodeId: code.id,
        pricingMethod: "fixed", unitPrice: ln.price.toFixed(2), sortOrder: n,
      });
      sum += ln.price; n++;
    }
    const tie = Math.abs(sum - t.perUnitTotal) < 0.01 ? "ties" : `OFF by $${(t.perUnitTotal - sum).toFixed(2)}`;
    console.log(`   ${t.name.padEnd(20)} ${String(n).padStart(2)} lines  $${sum.toFixed(2).padStart(10)}/unit  ${PLANNED[i]} units  (${tie})`);
  }

  // ---- 3. rent roll + units ------------------------------------------------
  const rr = d.rentRoll.units;
  const statusOf = (u: { occupancy: string | null }) => OCCUPANCY[(u.occupancy ?? "").toLowerCase()] ?? "vacant";
  const occupied = rr.filter((u) => statusOf(u) !== "vacant").length;
  const mkt = rr.reduce((s, u) => s + (u.marketRent ?? 0), 0);
  const inp = rr.reduce((s, u) => s + (u.inPlaceRent ?? 0), 0);
  const [batch] = await db()
    .insert(schema.rentRollBatches)
    .values({
      propertyId: property.id,
      fileName: "Aston - Construction Tracker.xlsx (Rent Roll)",
      sourceSystem: "Yardi", fileKind: "xlsx", status: "committed",
      asOfDate: d.rentRoll.asOfDate, rowCount: rr.length,
      occupiedCount: occupied, vacantCount: rr.length - occupied,
      noticeCount: rr.filter((u) => statusOf(u) === "notice").length,
      occupancyPct: ((occupied / rr.length) * 100).toFixed(2),
      totalMarketRent: mkt.toFixed(2), totalInPlaceRent: inp.toFixed(2),
      lossToLease: (mkt - inp).toFixed(2),
      parseMethod: "heuristic", committedAt: new Date(),
    })
    .returning({ id: schema.rentRollBatches.id });

  await db().insert(schema.rentRollUnits).values(
    rr.map((u) => ({
      propertyId: property.id, batchId: batch.id, unitNumber: u.unitNumber,
      floorPlanCode: u.floorPlanCode, beds: u.beds,
      baths: u.baths == null ? null : u.baths.toFixed(1), squareFeet: u.sqft,
      marketRent: u.marketRent == null ? null : u.marketRent.toFixed(2),
      inPlaceRent: u.inPlaceRent == null ? null : u.inPlaceRent.toFixed(2),
      status: statusOf(u),
    })),
  );
  const unitRows = await db()
    .insert(schema.units)
    .values(
      rr.map((u) => ({
        propertyId: property.id, unitNumber: u.unitNumber, floorplan: u.floorPlanCode,
        bedrooms: u.beds, baths: u.baths == null ? null : u.baths.toFixed(1), sqft: u.sqft,
        occupied: statusOf(u) !== "vacant",
        tier: (u.renovated ? "renovated" : "classic") as "renovated" | "classic",
      })),
    )
    .returning({ id: schema.units.id, unitNumber: schema.units.unitNumber });
  const unitByNumber = new Map(unitRows.map((u) => [u.unitNumber, u.id]));
  console.log(
    `\n3. rent roll            ${rr.length} units as of ${d.rentRoll.asOfDate}, ` +
      `${((occupied / rr.length) * 100).toFixed(1)}% occupied, ${rr.filter((u) => u.renovated).length} renovated`,
  );
  notes.push(`the rent roll sheet covers ${rr.length} of 392 units — it is a partial roll`);

  // ---- 4. vendors ----------------------------------------------------------
  const vendorNames = [...new Set(d.capex.map((c) => c.awardedVendor).filter((v): v is string => !!v))];
  const vendorIds = new Map<string, number>();
  for (const name of vendorNames) {
    const found = await db().query.vendors.findFirst({ where: eq(schema.vendors.name, name) });
    if (found) { vendorIds.set(name, found.id); continue; }
    const [v] = await db().insert(schema.vendors).values({ name, notes: "From the Aston tracker workbook" }).returning({ id: schema.vendors.id });
    vendorIds.set(name, v.id);
  }
  console.log(`4. vendors              ${vendorNames.length}: ${vendorNames.join(", ")}`);

  // ---- 5. common-area projects for awarded scopes --------------------------
  // Only scopes with an awarded vendor AND a budget: an unawarded $0 line is a
  // placeholder in the sheet, not work under way.
  const PHASE: Record<string, "precon" | "in_process" | "punch" | "complete"> = {
    "on track": "in_process", "at risk": "in_process", blocked: "precon",
    "not started": "precon", completed: "complete",
  };
  const matchedByName = new Map(preview.matched.map((m) => [m.name.toLowerCase(), m.costCodeId]));
  let made = 0;
  for (const c of d.capex) {
    if (!c.awardedVendor || c.amount <= 0) continue;
    const codeKey = NON_INTERIOR_CODE[c.item.toLowerCase()];
    const costCodeId = matchedByName.get(c.item.toLowerCase()) ?? (codeKey ? byCode.get(codeKey)?.id ?? null : null);
    const phase = PHASE[(c.status ?? "").toLowerCase()] ?? "precon";
    const [proj] = await db()
      .insert(schema.projects)
      .values({
        propertyId: property.id, kind: "common", name: c.item,
        costCodeId, budgetAmount: c.amount.toFixed(2), phase,
        notes: [c.task, c.update].filter(Boolean).join(" — ") || null,
      })
      .returning({ id: schema.projects.id });

    await db().insert(schema.scopeItems).values({
      projectId: proj.id, item: c.task ?? c.item, costCodeId,
      pricingMethod: "fixed", unitPrice: c.amount.toFixed(2), quantity: "1.00", sortOrder: 0,
    });
    await db().insert(schema.projectMilestones).values(defaultMilestoneRows(proj.id));
    await db().insert(schema.projectStageEvents).values({
      projectId: proj.id, toStage: "planned", toPhase: phase,
      note: `Imported from the tracker workbook — awarded to ${c.awardedVendor}`,
    });
    made++;
  }
  console.log(`5. common projects      ${made} awarded scopes`);

  // ---- 6. the one unit turn in flight --------------------------------------
  for (const t of d.turns) {
    const unitId = unitByNumber.get(t.unitNumber);
    if (!unitId) {
      notes.push(`unit turn ${t.unitNumber} is not in the rent roll sheet, so it has no unit record — skipped`);
      continue;
    }
    const tierId = tierByName.get(d.turnActuals[0]?.tier ?? "");
    const phase = (t.status ?? "").toLowerCase() === "in progress" ? "in_process" : "precon";
    const [proj] = await db()
      .insert(schema.projects)
      .values({
        propertyId: property.id, kind: "unit", name: `Unit ${t.unitNumber} Interior`,
        unitId, budgetGroupId: tierId ?? null, phase,
        startDate: t.start, previousRent: t.previousRent?.toFixed(2) ?? null,
        tradeOutRent: t.tradeOutRent?.toFixed(2) ?? null,
      })
      .returning({ id: schema.projects.id });

    // Scope comes from the sheet's ACTUAL vendor pricing, not the tier's plan —
    // this unit has real numbers booked against it.
    let n = 0;
    let sum = 0;
    for (const a of d.turnActuals) {
      const mapped = INTERIOR_SCOPE_CODE[a.scope.toLowerCase()];
      const code = mapped ? byCode.get(mapped) : undefined;
      if (!code) { notes.push(`turn ${t.unitNumber} scope "${a.scope}" ($${a.price.toLocaleString()}) has no chart code — skipped`); continue; }
      await db().insert(schema.scopeItems).values({
        projectId: proj.id, item: a.scope, costCodeId: code.id,
        pricingMethod: "fixed", unitPrice: a.price.toFixed(2), quantity: "1.00", sortOrder: n,
      });
      n++; sum += a.price;
    }
    await db().update(schema.projects).set({ budgetAmount: sum.toFixed(2) }).where(eq(schema.projects.id, proj.id));
    await db().insert(schema.projectMilestones).values(
      defaultMilestoneRows(proj.id).map((m) => ({
        ...m,
        plannedDate: m.phase === "in_process" ? t.start : m.phase === "complete" ? t.complete : null,
      })),
    );
    await db().insert(schema.projectStageEvents).values({
      projectId: proj.id, toStage: "planned", toPhase: phase, note: "Imported from the tracker workbook",
    });
    console.log(`6. unit turn            ${t.unitNumber} (${t.floorplan}) — ${n} scope lines, $${sum.toLocaleString()}, ${t.status}`);
  }

  console.log(`\nestimated mappings: ${ESTIMATED.join("; ")}`);
  console.log(`\nnotes (${notes.length}):`);
  for (const nt of notes) console.log(`   - ${nt}`);
  console.log(`\nhttp://localhost:3000/properties/${TRACKER_SLUG}/budget`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

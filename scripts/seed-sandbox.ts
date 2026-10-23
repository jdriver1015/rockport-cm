/**
 * Turns the database into a sandbox: backs up, wipes every property/project/
 * vendor/GL row, then fills it with dummy properties, units, vendors, projects,
 * bids and posted GL spend.
 *
 * Portfolio-wide configuration is kept (chart of accounts, mapping rules, budget
 * and contract templates, import formats, interior defaults); the chart is
 * (re)seeded by src/db/seed.ts first if it is missing.
 *
 * DESTRUCTIVE. Run: npx tsx scripts/seed-sandbox.ts --wipe
 * A JSON backup of every table is written to ./backups/ before anything is deleted.
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { mkdirSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq, isNull } from "drizzle-orm";
import postgres from "postgres";
import * as s from "../src/db/schema";
import { SANDBOX_USER } from "../src/lib/sandbox-user";
import { defaultMilestoneRows } from "../src/lib/milestones";

const KEEP = new Set([
  "charts_of_accounts",
  "cost_categories",
  "cost_codes",
  "mapping_rules",
  "budget_templates",
  "budget_template_lines",
  "contract_templates",
  "interior_default_settings",
  "spec_tables",
  "gl_import_formats",
  "rent_roll_formats",
  "rent_roll_mapping_examples",
]);

// --- dates ------------------------------------------------------------------
const TODAY = new Date("2026-10-23T12:00:00Z");
function day(offset: number): string {
  const d = new Date(TODAY);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}
function ts(offset: number): Date {
  const d = new Date(TODAY);
  d.setUTCDate(d.getUTCDate() + offset);
  return d;
}
const money = (n: number) => n.toFixed(2);

async function backup(client: postgres.Sql) {
  const tables = await client`select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE'`;
  const dump: Record<string, unknown[]> = {};
  for (const t of tables) dump[t.table_name] = await client.unsafe(`select * from "${t.table_name}"`);
  mkdirSync("backups", { recursive: true });
  const file = `backups/pre-sandbox-${Date.now()}.json`;
  writeFileSync(file, JSON.stringify(dump));
  console.log(`Backed up ${tables.length} tables → ${file}`);
}

async function wipe(client: postgres.Sql) {
  const tables = (await client`select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE'`).map(
    (r) => r.table_name as string,
  );
  const fks = await client`
    select c.conrelid::regclass::text as child, c.confrelid::regclass::text as parent
    from pg_constraint c where c.contype='f' and c.connamespace='public'::regnamespace`;
  const keep = new Set([...KEEP].filter((t) => tables.includes(t)));
  // A kept table that points at a wiped one (other than profiles, handled below) would dangle.
  for (let changed = true; changed; ) {
    changed = false;
    for (const f of fks) {
      if (keep.has(f.child) && !keep.has(f.parent) && f.parent !== "profiles" && f.child !== f.parent) {
        keep.delete(f.child);
        changed = true;
      }
    }
  }
  const wipeList = tables.filter((t) => !keep.has(t) && t !== "profiles");
  console.log(`Keeping: ${[...keep].join(", ")}`);
  await client.begin(async (tx) => {
    // Kept tables may name old profiles (created_by etc.); drop those links.
    for (const f of fks) {
      if (f.parent === "profiles" && keep.has(f.child)) {
        const cols = await tx`
          select a.attname from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=any(c.conkey)
          where c.contype='f' and c.conrelid=${f.child}::regclass and c.confrelid='profiles'::regclass`;
        for (const col of cols) await tx.unsafe(`update "${f.child}" set "${col.attname}" = null`);
      }
    }
    await tx.unsafe(`truncate table ${wipeList.map((t) => `"${t}"`).join(", ")} restart identity`);
    await tx`delete from profiles`;
  });
  console.log(`Wiped ${wipeList.length} tables + profiles`);
}

type Phase = "precon" | "in_process" | "punch" | "complete";
const PHASE_ORDER: Phase[] = ["precon", "in_process", "punch", "complete"];
const STAGE_FOR: Record<Phase, "planned" | "in_progress" | "punch" | "complete"> = {
  precon: "planned",
  in_process: "in_progress",
  punch: "punch",
  complete: "complete",
};

async function main() {
  if (!process.argv.includes("--wipe")) {
    throw new Error("Refusing to run without --wipe: this deletes all property, project, vendor and GL data.");
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (.env.local)");
  const client = postgres(url, { prepare: false, ssl: "require" });
  const db = drizzle(client, { schema: s });

  if (!process.argv.includes("--seed-only")) {
    await backup(client);
    await wipe(client);
  }

  // Chart of accounts: seed.ts is idempotent and only adds what is missing.
  execSync("npx tsx src/db/seed.ts", { stdio: "inherit" });

  const [chart] = await db
    .select()
    .from(s.chartsOfAccounts)
    .where(and(eq(s.chartsOfAccounts.name, "Westcreek Standard"), isNull(s.chartsOfAccounts.archivedAt)));
  if (!chart) throw new Error('No "Westcreek Standard" chart of accounts');
  const codeRows = await db.select().from(s.costCodes).where(eq(s.costCodes.chartId, chart.id));
  const code = (c: string) => {
    const r = codeRows.find((x) => x.code === c);
    if (!r) throw new Error(`Missing cost code ${c}`);
    return r;
  };

  // --- people ---------------------------------------------------------------
  const people = [
    { id: SANDBOX_USER.id, email: SANDBOX_USER.email, fullName: SANDBOX_USER.fullName, role: "admin" as const },
    { id: "00000000-0000-4000-8000-000000000002", email: "dana.whitfield@rockport.test", fullName: "Dana Whitfield", role: "cm" as const },
    { id: "00000000-0000-4000-8000-000000000003", email: "marcus.lee@rockport.test", fullName: "Marcus Lee", role: "cm" as const },
    { id: "00000000-0000-4000-8000-000000000004", email: "priya.nair@rockport.test", fullName: "Priya Nair", role: "site" as const },
  ];
  await db.insert(s.profiles).values(people);
  const managers = people.map((p) => p.id);

  // --- vendors ----------------------------------------------------------------
  const vendorDefs = [
    ["Lone Star Painting", "Painting", "Carla Ortiz"],
    ["Bluebonnet Flooring", "Flooring", "Tom Reyes"],
    ["Summit Roofing", "Roofing", "Jake Holloway"],
    ["Precision Cabinets & Counters", "Cabinets / Countertops", "Nina Park"],
    ["Brightway Electric", "Electrical / Lighting", "Sam Okafor"],
    ["ClearFlow Plumbing", "Plumbing", "Rita Delgado"],
    ["Greenscape Landscaping", "Landscaping", "Owen Burke"],
    ["Apex Appliance Supply", "Appliances", "Lena Fischer"],
    ["Keystone Paving", "Paving / Sealcoat", "Marty Gill"],
    ["Blue Harbor Pool Services", "Pool", "Dee Washington"],
  ] as const;
  const vendors = await db
    .insert(s.vendors)
    .values(vendorDefs.map(([name, trade]) => ({ name, trade })))
    .returning();
  await db.insert(s.vendorContacts).values(
    vendors.map((v, i) => ({
      vendorId: v.id,
      name: vendorDefs[i][2],
      title: "Estimator",
      email: `${vendorDefs[i][2].toLowerCase().replace(/ /g, ".")}@${v.name.toLowerCase().replace(/[^a-z]/g, "")}.test`,
      phone: `(555) 01${String(i).padStart(2, "0")}-${1000 + i * 7}`,
      isPrimary: true,
    })),
  );
  const vend = (name: string) => vendors.find((v) => v.name.startsWith(name))!;

  // --- properties & units -------------------------------------------------------
  const propDefs = [
    { name: "Maple Ridge Apartments", slug: "maple-ridge-apartments", city: "Austin", state: "TX", address: "4100 Maple Ridge Dr", unitCount: 240, entity: "Maple Ridge Holdings LLC" },
    { name: "Harbor Point", slug: "harbor-point", city: "Tampa", state: "FL", address: "800 Harbor Point Blvd", unitCount: 188, entity: "Harbor Point Partners LP" },
    { name: "Cedar Crossing", slug: "cedar-crossing", city: "Charlotte", state: "NC", address: "2250 Cedar Crossing Ln", unitCount: 312, entity: "Cedar Crossing Owner LLC" },
  ];
  const props = await db
    .insert(s.properties)
    .values(propDefs.map((p) => ({ ...p, chartOfAccountsId: chart.id, pmSystem: "Yardi", glUpdatedThru: day(-8) })))
    .returning();

  const plans = [
    { fp: "A1", beds: 1, baths: "1.0", sqft: 680 },
    { fp: "A2", beds: 1, baths: "1.0", sqft: 755 },
    { fp: "B1", beds: 2, baths: "2.0", sqft: 1040 },
    { fp: "B2", beds: 2, baths: "2.0", sqft: 1120 },
    { fp: "C1", beds: 3, baths: "2.0", sqft: 1340 },
  ];
  const unitsByProp = new Map<number, (typeof s.units.$inferSelect)[]>();
  for (const [pi, p] of props.entries()) {
    const rows = Array.from({ length: 30 }, (_, i) => {
      const plan = plans[i % plans.length];
      const floor = Math.floor(i / 10) + 1;
      return {
        propertyId: p.id,
        unitNumber: `${floor}${String((i % 10) + 1 + pi).padStart(2, "0")}`,
        floorplan: plan.fp,
        bedrooms: plan.beds,
        baths: plan.baths,
        sqft: plan.sqft,
        tier: (i % 3 === 0 ? "classic" : i % 3 === 1 ? "upgraded" : "renovated") as "classic" | "upgraded" | "renovated",
        occupied: i % 4 !== 0,
      };
    });
    unitsByProp.set(p.id, await db.insert(s.units).values(rows).returning());
  }

  // --- budgets ------------------------------------------------------------------
  const commonBudget: Record<string, number> = {
    "1000-0001": 185000, "1100-0001": 142000, "1100-0002": 18000, "1400-0001": 64000,
    "1500-0002": 38000, "1500-0003": 9000, "1600-0001": 72000, "1700-0001": 26000,
    "1800-0001": 55000, "1900-0001": 48000, "1900-0003": 22000, "2000-0002": 31000,
    "3000-0002": 40000,
  };
  for (const [pi, p] of props.entries()) {
    const scale = 0.85 + pi * 0.2;
    const lines = Object.entries(commonBudget).map(([c, amt]) => ({
      propertyId: p.id,
      costCodeId: code(c).id,
      uwAmount: money(Math.round((amt * scale) / 500) * 500),
    }));
    const interior: [string, number][] = [
      ["4000-0001", 1800], ["4000-0002", 2400], ["4000-0003", 2100], ["4000-0004", 1900],
      ["4000-0005", 700], ["4000-0006", 650], ["4000-0007", 1300], ["4000-0008", 1400], ["4000-0009", 350],
    ];
    const planned = 60;
    for (const [c, per] of interior) {
      lines.push({
        propertyId: p.id,
        costCodeId: code(c).id,
        uwAmount: money(per * planned),
        perUnitAmount: money(per),
        plannedUnits: planned,
      } as (typeof lines)[number]);
    }
    await db.insert(s.budgetLines).values(lines);
  }

  // --- GL batches ---------------------------------------------------------------
  const batches = new Map<number, number>();
  for (const p of props) {
    const [b] = await db
      .insert(s.importBatches)
      .values({
        propertyId: p.id,
        fileName: `${p.slug}-gl-2026-10.xlsx`,
        sourceSystem: "Yardi",
        status: "posted",
        uploadedBy: SANDBOX_USER.id,
        periodDate: day(-8),
      })
      .returning();
    batches.set(p.id, b.id);
  }

  // --- projects -----------------------------------------------------------------
  type CommonDef = { name: string; c: string; v: string; phase: Phase; budget: number; detail?: string; items: [string, string][] };
  const commonDefs: CommonDef[][] = [
    [
      { name: "Building Exterior Paint", c: "1000-0001", v: "Lone Star", phase: "in_process", budget: 185000, items: [["Pressure wash all elevations", "Prep"], ["Prime and caulk trim", "Prep"], ["Two coats body paint", "Paint"], ["Accent paint at stairwells", "Paint"]] },
      { name: "Roof Repair — Buildings 1–6", c: "1100-0001", v: "Summit", phase: "punch", budget: 142000, items: [["Replace failed shingles", "Roofing"], ["Re-flash vents and penetrations", "Roofing"], ["Gutter reattach and seal", "Gutters"]] },
      { name: "Pool Deck Resurface", c: "1800-0001", v: "Blue Harbor", phase: "precon", budget: 55000, items: [["Remove failed coping", "Pool"], ["Resurface pool deck", "Pool"], ["Replace furniture set", "Pool"]] },
      { name: "Leasing Center Refresh", c: "1600-0001", v: "Precision", phase: "complete", budget: 72000, items: [["New flooring and paint", "Leasing"], ["Reception desk and millwork", "Leasing"], ["Lighting package", "Leasing"]] },
    ],
    [
      { name: "LED Retrofit — Site Lighting", c: "1400-0001", v: "Brightway", phase: "in_process", budget: 76000, items: [["Replace pole heads with LED", "Lighting"], ["Breezeway fixtures", "Lighting"], ["Photocell controls", "Lighting"]] },
      { name: "Parking Lot Sealcoat & Stripe", c: "1500-0002", v: "Keystone", phase: "precon", budget: 46000, items: [["Crack fill", "Paving"], ["Sealcoat all lots", "Paving"], ["Restripe and ADA markings", "Paving"]] },
      { name: "Landscape Enhancements", c: "1900-0001", v: "Greenscape", phase: "complete", budget: 58000, items: [["Entry bed redesign", "Landscape"], ["Tree trim and removal", "Landscape"], ["Mulch and seasonal color", "Landscape"]] },
    ],
    [
      { name: "Monument Signage", c: "1700-0001", v: "Brightway", phase: "in_process", budget: 31000, items: [["Fabricate monument sign", "Signage"], ["Electrical and install", "Signage"]] },
      { name: "Exterior Paint — Phase 1", c: "1000-0001", v: "Lone Star", phase: "precon", budget: 210000, items: [["Prep and prime", "Paint"], ["Body and trim paint", "Paint"], ["Railings and doors", "Paint"]] },
      { name: "Irrigation System Replacement", c: "1900-0003", v: "Greenscape", phase: "punch", budget: 26000, items: [["Replace controllers", "Irrigation"], ["Repair broken lines and heads", "Irrigation"]] },
    ],
  ];

  const unitPhases: Phase[] = ["precon", "precon", "in_process", "in_process", "in_process", "punch", "punch", "complete", "complete", "complete"];
  const interiorCodes = ["4000-0001", "4000-0002", "4000-0003", "4000-0004", "4000-0005", "4000-0006", "4000-0007", "4000-0008"];
  const interiorItems: [string, string, string, number][] = [
    ["Paint walls, doors and trim", "Paint", "4000-0001", 1800],
    ["Replace bedroom carpet / LVP", "Flooring", "4000-0002", 2400],
    ["Appliance package", "Appliances", "4000-0003", 2100],
    ["Quartz-look countertops", "Countertops", "4000-0004", 1900],
    ["Kitchen tile backsplash", "Backsplash", "4000-0005", 700],
    ["New cabinet pulls and hinges", "Cabinets", "4000-0006", 650],
    ["Light and plumbing fixtures", "Fixtures", "4000-0007", 1300],
  ];

  let glRow = 1;
  let invoice = 4100;
  let projectCount = 0;

  async function createProject(opts: {
    propertyId: number;
    name: string;
    kind: "unit" | "common";
    costCodeId: number | null;
    unitId: number | null;
    phase: Phase;
    budget: number;
    vendorId: number;
    managerId: string;
    scope: { item: string; category: string; costCodeId: number | null; price: number }[];
    direct: boolean;
    competitor?: number;
    unit?: typeof s.units.$inferSelect;
  }) {
    projectCount++;
    const pi = PHASE_ORDER.indexOf(opts.phase);
    const age = 30 + (projectCount * 11) % 70; // days since created
    const created = -age;
    const total = opts.scope.reduce((a, x) => a + x.price, 0);
    const committed = pi >= 1 || (pi === 0 && projectCount % 3 === 0) ? total : 0;
    // Pre-con projects at the top of the funnel have no award yet.
    const awarded = pi >= 1;
    const stage = awarded || opts.phase !== "precon" ? STAGE_FOR[opts.phase] : projectCount % 2 ? "planned" : "bidding";

    const [proj] = await db
      .insert(s.projects)
      .values({
        propertyId: opts.propertyId,
        name: opts.name,
        kind: opts.kind,
        costCodeId: opts.costCodeId,
        unitId: opts.unitId,
        stage,
        phase: opts.phase,
        budgetAmount: money(opts.budget),
        committedCost: money(awarded ? total : 0),
        vendorId: awarded ? opts.vendorId : null,
        managerId: opts.managerId,
        scopeConfirmedAt: pi >= 1 || stage === "bidding" ? ts(created + 5) : null,
        contractSignedAt: awarded ? day(created + 14) : null,
        preWalkDate: day(created + 2),
        startDate: pi >= 1 ? day(created + 18) : null,
        completeDate: pi >= 3 ? day(-6 - (projectCount % 9)) : null,
        previousRent: opts.unit && pi >= 3 ? money(1450 + opts.unit.bedrooms! * 250) : null,
        tradeOutRent: opts.unit && pi >= 3 ? money(1625 + opts.unit.bedrooms! * 275) : null,
        leaseDate: opts.unit && pi >= 3 ? day(-2) : null,
        createdAt: ts(created),
      })
      .returning();
    void committed;

    // milestones: one per phase, actual dates for phases already entered
    const ms = defaultMilestoneRows(proj.id).map((m, i) => ({
      ...m,
      plannedDate: day(created + [0, 18, 32, 40][i]),
      actualDate: i <= pi ? day(created + [0, 18, 32, 40][i] + (i === 0 ? 0 : (projectCount + i) % 4)) : null,
    }));
    await db.insert(s.projectMilestones).values(ms);

    // stage history
    const events = [];
    for (let i = 1; i <= pi; i++) {
      events.push({
        projectId: proj.id,
        fromStage: STAGE_FOR[PHASE_ORDER[i - 1]],
        toStage: STAGE_FOR[PHASE_ORDER[i]],
        fromPhase: PHASE_ORDER[i - 1],
        toPhase: PHASE_ORDER[i],
        userId: opts.managerId,
        createdAt: ts(created + [0, 18, 32, 40][i]),
      });
    }
    if (events.length) await db.insert(s.projectStageEvents).values(events);

    // scope
    const scopeRows = await db
      .insert(s.scopeItems)
      .values(
        opts.scope.map((x, i) => ({
          projectId: proj.id,
          item: x.item,
          category: x.category,
          costCodeId: x.costCodeId,
          pricingMethod: "fixed" as const,
          unitPrice: money(x.price),
          quantity: "1.00",
          sortOrder: i,
          status: (pi >= 3 ? "complete" : pi === 2 ? (i % 4 === 0 ? "in_progress" : "complete") : pi === 1 ? (i % 2 ? "not_started" : "in_progress") : "not_started") as
            | "complete" | "in_progress" | "not_started",
          vendorId: awarded ? opts.vendorId : null,
        })),
      )
      .returning();

    // bids
    const mkBid = async (vendorId: number, factor: number, status: string, approved: boolean, source: "rfp" | "direct") => {
      const [b] = await db
        .insert(s.bids)
        .values({
          projectId: proj.id,
          vendorId,
          bidNumber: 1,
          status,
          approved,
          source,
          awardReason: source === "direct" ? "Standing rate agreement" : null,
          receivedDate: day(created + 10),
          sentAt: ts(created + 6),
          dueDate: day(created + 12),
        })
        .returning();
      await db.insert(s.bidLineItems).values(
        scopeRows.map((r, i) => ({
          bidId: b.id,
          scopeItemId: r.id,
          description: r.item,
          amount: money(opts.scope[i].price * factor),
          sortOrder: i,
        })),
      );
      if (source === "rfp") {
        await db.insert(s.bidEvents).values([
          { bidId: b.id, kind: "invited" as const, at: ts(created + 6) },
          { bidId: b.id, kind: "link_opened" as const, at: ts(created + 7) },
          { bidId: b.id, kind: "submitted" as const, at: ts(created + 10) },
        ]);
      }
    };
    if (awarded) {
      if (opts.direct) await mkBid(opts.vendorId, 1, "awarded", true, "direct");
      else {
        await mkBid(opts.vendorId, 1, "awarded", true, "rfp");
        await mkBid(opts.competitor ?? opts.vendorId, 1.09, "declined", false, "rfp");
      }
    } else if (stage === "bidding") {
      await mkBid(opts.vendorId, 1, "received", false, "rfp");
      await mkBid(opts.competitor ?? opts.vendorId, 1.07, "sent", false, "rfp");
    }

    // posted GL spend against the committed amount
    if (awarded) {
      const pct = pi >= 3 ? 1 : pi === 2 ? 0.8 : 0.4;
      const txns = opts.scope
        .map((x, i) => ({ x, i }))
        .filter(({ i }) => pi >= 2 || i % 2 === 0)
        .map(({ x, i }) => ({
          propertyId: opts.propertyId,
          batchId: batches.get(opts.propertyId)!,
          costCodeId: x.costCodeId ?? opts.costCodeId,
          originalCostCodeId: x.costCodeId ?? opts.costCodeId,
          projectId: proj.id,
          vendorId: opts.vendorId,
          vendorRaw: vendors.find((v) => v.id === opts.vendorId)!.name.toUpperCase(),
          description: x.item,
          amount: money(Math.round(x.price * pct * 100) / 100),
          txnDate: day(-12 - ((i * 5) % 20)),
          invoiceNo: `INV-${invoice++}`,
          unitLabel: opts.unit ? opts.unit.unitNumber : "General Exterior",
          glAccountRaw: "1740-0006",
          status: "posted" as const,
          sourceRow: glRow++,
          lienWaiver: pi >= 3,
          postedAt: ts(-8),
        }));
      if (txns.length) await db.insert(s.glTransactions).values(txns);
    }
    return proj;
  }

  for (const [pi, p] of props.entries()) {
    const mgr = (i: number) => managers[(i + pi) % managers.length];
    let n = 0;
    for (const d of commonDefs[pi]) {
      const price = d.budget / d.items.length;
      await createProject({
        propertyId: p.id,
        name: d.name,
        kind: "common",
        costCodeId: code(d.c).id,
        unitId: null,
        phase: d.phase,
        budget: d.budget,
        vendorId: vend(d.v).id,
        competitor: vend(d.v === "Summit" ? "Keystone" : "Greenscape").id,
        managerId: mgr(n++),
        direct: false,
        scope: d.items.map(([item, category], i) => ({
          item,
          category,
          costCodeId: code(d.c).id,
          price: Math.round(price * (i % 2 ? 0.8 : 1.2)),
        })),
      });
    }
    const units = unitsByProp.get(p.id)!;
    for (const [ui, phase] of unitPhases.entries()) {
      const unit = units[ui + 1];
      const items = interiorItems.slice(0, 5 + (ui % 3));
      const scope = items.map(([item, category, c, price]) => ({
        item,
        category,
        costCodeId: code(c).id,
        price: price + ((ui * 37) % 150),
      }));
      await createProject({
        propertyId: p.id,
        name: `Unit ${unit.unitNumber} Interior Upgrade`,
        kind: "unit",
        costCodeId: null,
        unitId: unit.id,
        phase,
        budget: scope.reduce((a, x) => a + x.price, 0) + 600,
        vendorId: vend(ui % 2 ? "Lone Star" : "Bluebonnet").id,
        managerId: mgr(ui),
        direct: true,
        scope,
        unit,
      });
    }
  }
  void interiorCodes;

  console.log(`Seeded ${props.length} properties, ${projectCount} projects, ${vendors.length} vendors.`);
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Seeds the two standard interior scope groups under Settings → Interior Scope
 * Groups: "Enhanced" (mid-tier turn) and "Signature" (top-tier turn). Content
 * is description-first — work lines, standard materials, and product links
 * extracted from the Agave ATS Exhibit-A scopes (Barton = Enhanced, Montrose =
 * Signature). No pricing: pricing is set per property/project when bids come in.
 *
 * Idempotent — a template that already has items is left untouched; an existing
 * empty template (e.g. created through the UI) gets its items seeded.
 * Run: npx tsx scripts/seed-scope-templates.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { scopeGroupTemplates, scopeGroupTemplateItems } from "../src/db/schema";

type Item = {
  /** Work description, Exhibit-A style ("R&R kitchen faucet.") */
  name: string;
  /** Trade section */
  category: string;
  /** Add/Deduct Alternative — optional line, priced separately per project */
  isAlternate?: boolean;
  location?: string;
  /** Standard material / spec (finish schedule) */
  material?: string;
  productLink?: string;
  /** Exclusions / clarifications */
  notes?: string;
  /** 4000-series code as a string; resolved per property chart on use */
  costCodeRef?: string;
};

const SW_PROMAR =
  "https://www.sherwin-williams.com/painting-contractors/products/promar-400-zero-voc-interior-latex";

const PAINT_3_TONE =
  "SW ProMar 400 — Walls: 7008 Alabaster (eggshell) · Ceiling: 7006 Extra White (flat) · Doors/Trim: 7008 Alabaster (semi-gloss)";

const ENHANCED: Item[] = [
  // ---- Base scope ----
  {
    name: "R&R cabinet door & drawer pulls.",
    category: "Cabinets",
    location: "Kitchen / Bath",
    material: '6.75" Matte Black cabinet pull + matte black T-knob, or similar',
    notes: "See alternates for cabinet painting.",
    costCodeRef: "4000-0006",
  },
  {
    name: "R&R kitchen light — flushmount.",
    category: "Lighting",
    location: "Kitchen",
    material: "LED flushmount, die-cast aluminum housing, frosted lens, 15W, 5CCT, dimmable, or similar",
    costCodeRef: "4000-0007",
  },
  {
    name: "R&R pendant light — bartop, if existing.",
    category: "Lighting",
    location: "Kitchen",
    material: '14" one-light pendant or 1-light minimalist metal pendant',
    costCodeRef: "4000-0007",
  },
  {
    name: "Install new undercabinet lighting at kitchen upper cabinets.",
    category: "Lighting",
    location: "Kitchen",
    notes: "Which upper cabinets receive light strips TBD per cabinet layout.",
    costCodeRef: "4000-0007",
  },
  {
    name: "Install 2 new USB outlets at kitchen location.",
    category: "Electrical",
    location: "Kitchen Island",
    material: "20A outlet with one Type A and one Type C USB port, 5V 4.2A, white",
  },
  {
    name: "Undercabinet lighting — tie into existing electric on nearby device, using existing branch circuit.",
    category: "Electrical",
    location: "Kitchen",
    notes: "Tie-in point to be determined in the field.",
  },
  {
    name: "R&R kitchen faucet.",
    category: "Plumbing",
    location: "Kitchen",
    material:
      "Single-handle pull-out sprayer, solid brass construction, chrome, 1.8 GPM, cUPC listed, or similar",
    costCodeRef: "4000-0007",
  },
  {
    name: "R&R kitchen sink — drop-in single bowl.",
    category: "Plumbing",
    location: "Kitchen",
    material:
      "Glacier Bay 33 in. drop-in single-bowl black granite composite sink w/ stainless strainer (GCT412BLACK)",
    productLink:
      "https://www.homedepot.com/p/Glacier-Bay-33-in-Drop-In-Single-Bowl-Black-Granite-Composite-Kitchen-Sink-with-Stainless-Steel-Strainer-GCT412BLACK/333352667",
    costCodeRef: "4000-0007",
  },
  {
    name: "R&R carpet in bedrooms & associated closets only. Includes minor floor prep — tack strip removal & surface clean.",
    category: "Flooring",
    location: "Bedrooms",
    notes: "Excludes living rooms, halls, & stairs.",
    costCodeRef: "4000-0002",
  },
  {
    name: "Install kitchen tile backsplash below upper cabinets w/ metal edging where applicable. Includes behind range location.",
    category: "Tile",
    location: "Kitchen",
    material:
      "Daltile Rhyme & Reason RR17 Canvas 6x6 (stacked, rotating patterns) · Mapei eggshell grout, 1/16 in. joint · L-shape edge trim in Warm White",
    productLink:
      "https://digitalassets.daltile.com/content/dam/Marazzi/website/documents/product-detail-page/rhymeandreason/MZ_RhymeandReason_SS.pdf",
    notes: "Excludes behind refrigerator.",
    costCodeRef: "4000-0005",
  },
  {
    name: "Install new frame on existing mirror.",
    category: "Mirrors",
    location: "Bath",
    costCodeRef: "4000-0007",
  },
  {
    name: "R&Reset refrigerator, range, & dishwasher for paint prep.",
    category: "Appliances",
    location: "Kitchen",
    notes: "Labor only.",
    costCodeRef: "4000-0003",
  },
  {
    name: "Paint interior — walls, doors, & trim, 3-tone color scheme. Includes prep work & floor protection.",
    category: "Paint & Drywall",
    location: "Throughout",
    material: PAINT_3_TONE,
    productLink: `${SW_PROMAR}?colorPartNumber=SW7008`,
    costCodeRef: "4000-0001",
  },
  {
    name: "Drywall footprint repairs.",
    category: "Paint & Drywall",
    location: "Throughout",
    costCodeRef: "4000-0001",
  },
  {
    name: "Final clean.",
    category: "General / Misc",
    location: "Throughout",
    costCodeRef: "4000-0009",
  },
  // ---- Add/Deduct Alternatives ----
  {
    name: "Prep and paint cabinet boxes, doors, & fronts in kitchen and bath (int. & ext.). Includes toilet upper, medicine, and linen cabinets.",
    category: "Cabinets",
    isAlternate: true,
    location: "Kitchen / Bath",
    material:
      "SW Pro Industrial Pre-Cat — SW7636 Origami White (uppers & bases) · SW9174 Moth Wing (island only)",
    productLink:
      "https://www.sherwin-williams.com/painting-contractors/products/pro-industrial-precatalyzed-waterbased-epoxy?colorPartNumber=SW7636",
    costCodeRef: "4000-0006",
  },
  {
    name: "Resurface existing tub.",
    category: "General / Misc",
    isAlternate: true,
    location: "Bath",
  },
  {
    name: "Resurface existing tub & surround.",
    category: "General / Misc",
    isAlternate: true,
    location: "Bath",
  },
  {
    name: "R&Reset / install washer & dryer appliances.",
    category: "Appliances",
    isAlternate: true,
    notes: "Labor only — appliances supplied by other.",
    costCodeRef: "4000-0003",
  },
];

const SIGNATURE: Item[] = [
  // ---- Base scope ----
  {
    name: "R&R cabinet door & drawer pulls.",
    category: "Cabinets",
    location: "Kitchen / Bath",
    material: '6.75" Matte Black cabinet pull + matte black T-knob, or similar',
    notes:
      "See alternates for new cabinet doors & drawer fronts, range upper cabinet, and cabinet painting.",
    costCodeRef: "4000-0006",
  },
  {
    name: "R&R kitchen countertops — 2 cm Level I quartz.",
    category: "Countertops",
    location: "Kitchen",
    material: "Lyra Quartz 2CM (Silestone)",
    productLink: "https://www.cosentino.com/usa/colors/silestone/lyra/",
    costCodeRef: "4000-0004",
  },
  {
    name: "R&R bath countertops — 2 cm Level I quartz. Includes back and sidesplash where applicable.",
    category: "Countertops",
    location: "Bath",
    material: "Lyra Quartz 2CM (Silestone)",
    productLink: "https://www.cosentino.com/usa/colors/silestone/lyra/",
    costCodeRef: "4000-0004",
  },
  {
    name: "Clean and paint existing vent registers & return grills.",
    category: "Mechanical",
    location: "Throughout",
    notes: "Excludes ductwork cleaning and bathroom exhaust fans.",
  },
  {
    name: "Install 3 new USB outlets at kitchen location. Includes upper range cabinet.",
    category: "Electrical",
    location: "Kitchen Island & Master Bedroom",
    material:
      "Leviton Decora White 15A tamper-resistant duplex outlet w/ USB Type A/C charger (T5638-B3W)",
    productLink:
      "https://www.homedepot.com/p/Leviton-Decora-White-15-Amp-Tamper-Resistant-Duplex-Outlet-with-USB-Charger-Type-A-C-3-6-Amp-18-Watt-Outlet-3-Pack-T5638-B3W-M13-T5638-B3W/331712120",
  },
  {
    name: "Undercabinet lighting — tie into existing electric on nearby device, using existing branch circuit.",
    category: "Electrical",
    location: "Kitchen",
    notes: "Tie-in point to be determined in the field.",
  },
  {
    name: "R&R kitchen light — flushmount.",
    category: "Lighting",
    location: "Kitchen, Entry, Hallways",
    material:
      '13" LED flushmount, die-cast aluminum, frosted lens, 13W, 5CCT, dimmable (ML-DL-13S-13W-5CCT-120), or similar; replaces track lighting',
    costCodeRef: "4000-0007",
  },
  {
    name: "R&R pendant light — bartop.",
    category: "Lighting",
    location: "Kitchen",
    material: '14" one-light pendant or 1-light minimalist metal pendant',
    costCodeRef: "4000-0007",
  },
  {
    name: "R&R vanity lights.",
    category: "Lighting",
    location: "Bath",
    material:
      '24" LED cylinder sconce, matte black, 25W, 3CCT selectable (ML-TH-2285), or similar',
    costCodeRef: "4000-0007",
  },
  {
    name: "R&R flushmount lights.",
    category: "Lighting",
    location: "Closets & small spaces",
    material: "7W LED flushmount, 5CCT, dimmable (ML-DL-7S-7WT-5CCT-120), or similar",
    costCodeRef: "4000-0007",
  },
  {
    name: "R&R ceiling fans with light kit.",
    category: "Lighting",
    location: "Living Room & Bedrooms (where existing)",
    material:
      '52" 5-blade cylinder fan, black finish, integrated LED (3K/4K/5K), downrod, wall remote, black/walnut blades',
    costCodeRef: "4000-0007",
  },
  {
    name: "R&R closet light.",
    category: "Lighting",
    location: "Closets",
    costCodeRef: "4000-0007",
  },
  {
    name: "R&R recessed lights with new LED retrofit — slim.",
    category: "Lighting",
    location: "Throughout",
    costCodeRef: "4000-0007",
  },
  {
    name: "R&R supply lines.",
    category: "Plumbing",
    location: "Throughout",
    notes: "Excludes angle stops.",
  },
  {
    name: "R&R kitchen sink — undermount single bowl.",
    category: "Plumbing",
    location: "Kitchen",
    material:
      '27" black undermount sink · Glacier Bay disposal rim & stopper, stainless w/ matte black finish',
    productLink:
      "https://www.homedepot.com/p/Glacier-Bay-Garbage-Disposal-Rim-and-Stopper-Stainless-steel-with-matte-black-finish-7041-101MB/315413220",
    costCodeRef: "4000-0007",
  },
  {
    name: "R&R kitchen faucet.",
    category: "Plumbing",
    location: "Kitchen",
    material:
      "Single-handle pull-out sprayer, black, 1.8 GPM, cUPC listed (ML-TH-Faucet-90486-BK), or similar",
    costCodeRef: "4000-0007",
  },
  {
    name: "R&R kitchen sink plumbing.",
    category: "Plumbing",
    location: "Kitchen",
  },
  {
    name: "R&R garbage disposal.",
    category: "Plumbing",
    location: "Kitchen",
    material:
      "Maintenance Warehouse 1/2 HP continuous-feed disposal, corded, w/ Bio-Shield odor protection",
    productLink:
      "https://punchout.hdsupplysolutions.com/p/garbage-disposals-repair-00-15-25/maintenance-warehouse-1-2-hp-continuous-feed-garbage-disposal-corded-with-bio-shield-odor-protection-p113743",
    costCodeRef: "4000-0007",
  },
  {
    name: "R&R vanity sink — undermount rectangular.",
    category: "Plumbing",
    location: "Bath",
    costCodeRef: "4000-0007",
  },
  {
    name: "R&R vanity faucet.",
    category: "Plumbing",
    location: "Bath",
    material: '4 in. centerset double-handle high-arc bathroom faucet in black (AL-2C11B)',
    productLink:
      "https://www.homedepot.com/p/4-in-Centerset-Double-Handle-High-Arc-Bathroom-Faucet-in-Black-AL-2C11B/326395529",
    costCodeRef: "4000-0007",
  },
  {
    name: "R&Reset existing toilet.",
    category: "Plumbing",
    location: "Bath",
  },
  {
    name: "R&R door hardware — passage.",
    category: "Doors & Hardware",
    location: "Throughout",
    material: "Kwikset Halifax Square matte black hall/closet passage handle (720HFLSQT514CP)",
    productLink:
      "https://www.homedepot.com/p/Kwikset-Halifax-Square-Matte-Black-Hall-Closet-Passage-Door-Handle-720HFLSQT514CP/316727672",
    notes: "Excludes door hinges (painted) and entry/patio deadbolts & knobs.",
    costCodeRef: "4000-0007",
  },
  {
    name: "R&R door hardware — privacy.",
    category: "Doors & Hardware",
    location: "Throughout",
    material:
      "Kwikset Halifax Square matte black privacy bed/bath handle w/ lock (730HFLSQT514CP); half-dummy where applicable (788HFL-SQT-514)",
    productLink:
      "https://www.homedepot.com/p/Kwikset-Halifax-Square-Matte-Black-Privacy-Bed-Bath-Door-Handle-with-Lock-730HFLSQT514CP/316727683",
    costCodeRef: "4000-0007",
  },
  {
    name: "R&R door stops.",
    category: "Doors & Hardware",
    location: "Throughout",
  },
  {
    name: "R&R flooring throughout w/ new glue-down LVP plank — entire unit complete. Bathroom tile will be demo'd. Includes minor floor prep — tack strip removal & surface clean.",
    category: "Flooring",
    location: "Throughout",
    material: 'Mohawk Driftwood LVP, 7" x 48", 6 Mil',
    notes:
      "Excludes floor leveling, luan board, or unforeseen subfloor conditions — priced separately if found.",
    costCodeRef: "4000-0002",
  },
  {
    name: "R&R 1/4 round — throughout.",
    category: "Millwork",
    location: "Throughout",
  },
  {
    name: "Install kitchen tile backsplash below upper cabinets w/ metal edging where applicable. Includes behind range location.",
    category: "Tile",
    location: "Kitchen",
    material:
      "Daltile Zellige Neo Lana ZL07 3x12 glazed ceramic, glossy (horizontal stacked) · Mapei Eggshell (5220) grout · L-shape edge trim in Warm White",
    productLink:
      "https://digitalassets.daltile.com/content/dam/Marazzi/website/documents/product-detail-page/zelligeneo/MZ_ZelligeNeo_SS.pdf",
    notes: "Excludes behind refrigerator.",
    costCodeRef: "4000-0005",
  },
  {
    name: "R&R towel bar, toilet paper holder, towel ring, & robe hook.",
    category: "Bath Accessories",
    location: "Bath",
    material: "USHOWER matte black 4-piece SUS304 stainless bathroom hardware set, 24 in. towel bar",
    productLink:
      "https://www.amazon.com/USHOWER-Bathroom-Hardware-Stainless-Accessories/dp/B0C7W2BQ4L",
    notes: "Existing curved / tension shower rods are to remain.",
    costCodeRef: "4000-0007",
  },
  {
    name: "R&R mirror.",
    category: "Mirrors",
    location: "Bath",
    material: "BEAUTYPEAK 30 in. x 48 in. rectangle black framed wall mirror",
    productLink:
      "https://www.lowes.com/pd/BEAUTYPEAK-30-in-W-x-48-in-H-Black-Framed-Wall-Mirror/5015053175",
    costCodeRef: "4000-0007",
  },
  {
    name: "R&R refrigerator, range, microhood, & dishwasher (where applicable). R&Reset existing washer & electric dryer.",
    category: "Appliances",
    location: "Kitchen / Laundry",
    notes:
      "Labor only — appliances supplied by owner; dropped at designated location for property maintenance.",
    costCodeRef: "4000-0003",
  },
  {
    name: "Paint interior — walls, doors, & trim, 3-tone color scheme.",
    category: "Paint & Drywall",
    location: "Throughout",
    material: PAINT_3_TONE,
    productLink: `${SW_PROMAR}?colorPartNumber=SW7008`,
    notes: "Existing door hinges to be painted.",
    costCodeRef: "4000-0001",
  },
  {
    name: "Drywall footprint repairs.",
    category: "Paint & Drywall",
    location: "Throughout",
    costCodeRef: "4000-0001",
  },
  {
    name: "Demo / trash / appliance haul-off.",
    category: "General / Misc",
    location: "Throughout",
    costCodeRef: "4000-0009",
  },
  {
    name: "Final clean.",
    category: "General / Misc",
    location: "Throughout",
    costCodeRef: "4000-0009",
  },
  // ---- Add/Deduct Alternatives ----
  {
    name: "R&R cabinet doors & drawer fronts. Includes medicine cabinet door, toilet cabinet door, & linen cabinet doors if existing.",
    category: "Cabinets",
    isAlternate: true,
    location: "Kitchen / Bath",
    material:
      "Northern Contours slim shaker, full overlay, soft-close hardware; custom color match — Accessible Beige uppers/lowers, Urbane Bronze island accent",
    productLink: "https://www.northerncontours.com/Products#/Detail/20",
    costCodeRef: "4000-0006",
  },
  {
    name: "Prep and paint cabinet boxes, doors, & fronts in kitchen and bath (int. & ext.). Includes toilet upper cabinet and medicine cabinet box, door, & frame.",
    category: "Cabinets",
    isAlternate: true,
    location: "Kitchen / Bath",
    material: "SW Pro Industrial Pre-Cat — SW7636 Origami White, semi-gloss",
    productLink:
      "https://www.sherwin-williams.com/painting-contractors/products/pro-industrial-precatalyzed-waterbased-epoxy?colorPartNumber=SW7636",
    costCodeRef: "4000-0006",
  },
  {
    name: "RR&R range upper cabinet box to 3012.",
    category: "Cabinets",
    isAlternate: true,
    location: "Kitchen",
    costCodeRef: "4000-0006",
  },
  {
    name: "Resurface existing tub.",
    category: "General / Misc",
    isAlternate: true,
    location: "Bath",
  },
  {
    name: "Resurface existing tub & surround.",
    category: "General / Misc",
    isAlternate: true,
    location: "Bath",
  },
];

const TEMPLATES: { name: string; description: string; items: Item[] }[] = [
  { name: "Enhanced", description: "Mid-tier interior turn.", items: ENHANCED },
  { name: "Signature", description: "Top-tier interior turn.", items: SIGNATURE },
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (.env.local)");
  const client = postgres(url, { prepare: false, ssl: "require" });
  const db = drizzle(client);

  for (const [i, tpl] of TEMPLATES.entries()) {
    const existing = await db
      .select({ id: scopeGroupTemplates.id })
      .from(scopeGroupTemplates)
      .where(eq(scopeGroupTemplates.name, tpl.name));

    let templateId: number;
    if (existing.length > 0) {
      templateId = existing[0].id;
      const items = await db
        .select({ id: scopeGroupTemplateItems.id })
        .from(scopeGroupTemplateItems)
        .where(eq(scopeGroupTemplateItems.templateId, templateId));
      if (items.length > 0) {
        console.log(`  "${tpl.name}" already has ${items.length} items — skipping`);
        continue;
      }
      console.log(`  "${tpl.name}" exists and is empty — seeding items`);
    } else {
      const [row] = await db
        .insert(scopeGroupTemplates)
        .values({ name: tpl.name, description: tpl.description, sortOrder: i })
        .returning({ id: scopeGroupTemplates.id });
      templateId = row.id;
      console.log(`  Created "${tpl.name}"`);
    }

    await db.insert(scopeGroupTemplateItems).values(
      tpl.items.map((it, j) => ({
        templateId,
        name: it.name,
        category: it.category,
        isAlternate: it.isAlternate ?? false,
        location: it.location ?? null,
        productLink: it.productLink ?? null,
        materialAssumptions: it.material ?? null,
        notes: it.notes ?? null,
        costCodeRef: it.costCodeRef ?? null,
        sortOrder: j,
      })),
    );
    console.log(`  Seeded ${tpl.items.length} lines into "${tpl.name}"`);
  }

  await client.end();
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * One-off: file real vendor bid/contract documents from the Aston Post Oak
 * OneDrive folder against the matching projects, using the manual-bid +
 * bid-attachment path (see "Let a bid or a contract exist outside the
 * app"). Run once; safe to re-run only after clearing what it created,
 * since addBid always inserts a new row.
 *
 *   npx tsx scripts/upload-aston-bids.ts
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import fs from "node:fs";
import { and, eq } from "drizzle-orm";
import { db, schema } from "../src/db";
import { createAdminClient, ATTACHMENTS_BUCKET } from "../src/lib/supabase/admin";
import { addBid, setBidWinner } from "../src/lib/actions/bids";
import { recordExecutedContractRow } from "../src/lib/contracts";

const BASE =
  "C:/Users/JimmyDriver/OneDrive - crcapitaltx/CR Capital/3. Asset Management/zRockport Portfolio/Aston Post Oak";

/** revalidatePath throws outside a request; the DB write it wraps has already
 *  committed by the time it does, so swallow just that one failure mode. */
async function ignoringRevalidate<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof Error && err.message.includes("static generation store")) {
      return fallback;
    }
    throw err;
  }
}

async function getOrCreateVendor(name: string, trade: string | null) {
  const existing = await db().query.vendors.findFirst({ where: eq(schema.vendors.name, name) });
  if (existing) return existing.id;
  const [row] = await db().insert(schema.vendors).values({ name, trade }).returning({ id: schema.vendors.id });
  return row.id;
}

async function uploadAttachment(opts: {
  propertyId: number;
  projectId: number;
  bidId: number;
  filePath: string;
  stageTag: string;
}) {
  const admin = createAdminClient();
  const bytes = fs.readFileSync(opts.filePath);
  const fileName = opts.filePath.split(/[\\/]/).pop()!;
  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
  const path = `bids/${opts.bidId}/${crypto.randomUUID()}-${safe}`;
  const { error } = await admin.storage
    .from(ATTACHMENTS_BUCKET)
    .upload(path, bytes, { contentType: "application/pdf", upsert: false });
  if (error) throw new Error(`upload failed for ${fileName}: ${error.message}`);
  await db().insert(schema.attachments).values({
    propertyId: opts.propertyId,
    projectId: opts.projectId,
    bidId: opts.bidId,
    kind: "bid",
    storagePath: path,
    stageTag: opts.stageTag,
    caption: fileName,
  });
  console.log(`    attached ${fileName}`);
  return path;
}

type Plan = {
  project: string;
  vendor: string;
  trade: string;
  amount: number;
  award: boolean;
  contractFile?: string;
  files: string[];
  note: string;
};

const PLANS: Plan[] = [
  {
    project: "Signage",
    vendor: "Dodd CG, LLC (Dodd Creative)",
    trade: "Signage",
    amount: 154075.71,
    award: true,
    contractFile: `${BASE}/C2_Planning Docs and Site Maps/Signage/Value Engineered Contract/368-1005 ASTON POST OAK Signage Contract.pdf`,
    files: [
      `${BASE}/C2_Planning Docs and Site Maps/Signage/Value Engineered Contract/368-1005 ASTON POST OAK Signage Contract.pdf`,
    ],
    note: "Value-engineered signage contract, imported from the property OneDrive folder.",
  },
  {
    project: "Exterior Paint",
    vendor: "Ace Nationwide Construction LLC",
    trade: "Exterior",
    amount: 543325,
    award: true,
    contractFile: `${BASE}/C3_Vendor Contracts_Invoices/Executed_Contract_Aston.pdf`,
    files: [`${BASE}/C3_Vendor Contracts_Invoices/Executed_Contract_Aston.pdf`],
    note: "Executed contract also covers Balconies and Siding and Trim (Exterior Paint, Railings, Balconies, Window Trimming & Siding) — see those two projects, which were left unawarded because the contract carries one lump sum with no per-category split.",
  },
  {
    project: "Roof",
    vendor: "Guy Roofing, Inc.",
    trade: "Roofing",
    amount: 849000,
    award: false,
    files: [
      `${BASE}/C4_Budgets_Estimates/Guy Roofing/IMT Uptown Post Oak - Houston, TX - Guy Roofing Inc. (4).pdf`,
    ],
    note: "Roofing proposal, imported from the property OneDrive folder. Not yet awarded — the folder holds a 33% deposit invoice and conditional waiver suggesting work may already be under way; confirm and award manually.",
  },
  {
    project: "Frontage",
    vendor: "TGO Landscaping, Inc.",
    trade: "Landscaping",
    amount: 23716.4,
    award: false,
    files: [
      `${BASE}/C4_Budgets_Estimates/TGO Landscaping/Estimate_22682_from_TGO_Landscaping_Inc.pdf`,
    ],
    note: "Landscaping estimate, imported from the property OneDrive folder.",
  },
  {
    project: "Tech Package",
    vendor: "Rently",
    trade: "Smart home / tech",
    amount: 228770.97,
    award: false,
    files: [
      `${BASE}/C4_Budgets_Estimates/Rently/ZRS Management (Orlando, FL) - [Smart Home - Aston Post Oak - 392 Units].pdf`,
      `${BASE}/C4_Budgets_Estimates/Rently/Aston CRF Tech Package 7.22.pdf`,
    ],
    note: "Smart-home/tech proposal (base option). The source PDF prices a second option at $240,228.97 with shipping — verify which was selected.",
  },
  {
    project: "Fitness Equipment",
    vendor: "FitLogistics",
    trade: "Fitness equipment",
    amount: 24975.63,
    award: false,
    files: [
      `${BASE}/C4_Budgets_Estimates/FitLogistics/Aston Post Oak Recovery Proposal.pdf`,
      `${BASE}/C4_Budgets_Estimates/FitLogistics/Aston Recovery CP.pdf`,
    ],
    note: "Recovery/fitness equipment proposal — well above the $10,000 planned budget for this project; flagged for review, not awarded.",
  },
];

async function main() {
  const property = await db().query.properties.findFirst({
    where: eq(schema.properties.slug, "aston-post-oak-2"),
  });
  if (!property) throw new Error("Aston Post Oak property not found");

  for (const plan of PLANS) {
    console.log(`\n${plan.project} -> ${plan.vendor}`);
    const project = await db().query.projects.findFirst({
      where: and(eq(schema.projects.propertyId, property.id), eq(schema.projects.name, plan.project)),
    });
    if (!project) {
      console.log(`  SKIP — project "${plan.project}" not found`);
      continue;
    }

    const vendorId = await getOrCreateVendor(plan.vendor, plan.trade);

    const res = await ignoringRevalidate(
      () =>
        addBid({
          propertyId: property.id,
          projectId: project.id,
          vendorId,
          note: plan.note,
          lines: [{ description: `${plan.project} — ${plan.vendor}`, amount: plan.amount }],
        }),
      { ok: true as const },
    );
    if (!res.ok) {
      console.log(`  FAILED addBid: ${res.error}`);
      continue;
    }

    const bid = await db().query.bids.findFirst({
      where: and(eq(schema.bids.projectId, project.id), eq(schema.bids.vendorId, vendorId)),
      orderBy: (b, { desc }) => [desc(b.id)],
    });
    if (!bid) {
      console.log("  FAILED — could not read back inserted bid");
      continue;
    }
    console.log(`  bid #${bid.id} created — $${plan.amount.toLocaleString()}`);

    for (const f of plan.files) {
      if (!fs.existsSync(f)) {
        console.log(`  MISSING file: ${f}`);
        continue;
      }
      await uploadAttachment({
        propertyId: property.id,
        projectId: project.id,
        bidId: bid.id,
        filePath: f,
        stageTag: project.stage,
      });
    }

    if (plan.award) {
      const win = await ignoringRevalidate(
        () => setBidWinner({ id: bid.id, propertyId: property.id, projectId: project.id }),
        { ok: true as const },
      );
      if (!win.ok) {
        console.log(`  FAILED to award: ${win.error}`);
        continue;
      }
      console.log("  awarded");

      if (plan.contractFile) {
        const admin = createAdminClient();
        const bytes = fs.readFileSync(plan.contractFile);
        const fileName = plan.contractFile.split(/[\\/]/).pop()!;
        const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
        const storagePath = `contracts/${bid.id}/${crypto.randomUUID()}-${safe}`;
        const { error } = await admin.storage
          .from(ATTACHMENTS_BUCKET)
          .upload(storagePath, bytes, { contentType: "application/pdf", upsert: false });
        if (error) {
          console.log(`  FAILED contract upload: ${error.message}`);
          continue;
        }
        const rec = await recordExecutedContractRow(bid.id, storagePath);
        if (!rec.ok) {
          console.log(`  FAILED recordExecutedContractRow: ${rec.error}`);
          continue;
        }
        console.log(`  contract recorded as executed (#${rec.contractId})`);
      }
    }
  }

  console.log("\nDone.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

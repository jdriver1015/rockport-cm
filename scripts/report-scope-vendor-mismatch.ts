/**
 * List scope lines whose vendor disagrees with award coverage.
 *
 * `scope_items.vendor_id` is now written only by the award that covers a line.
 * Rows created before that carry hand-entered vendors, some of which no award
 * backs. Those are not deleted — a vendor somebody typed in is a real decision
 * and clearing it to satisfy a new invariant is how you lose it silently — so
 * this reports them instead, for a person to look at and decide.
 *
 * Read-only. Writes nothing.
 *
 *   npx tsx scripts/report-scope-vendor-mismatch.ts
 *
 * Two kinds of disagreement:
 *   UNBACKED  the line names a vendor but no approved bid covers the line
 *   CONFLICT  an approved bid covers the line, naming a different vendor
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "../src/db";
// Match other scripts/ files: tsx invokes them directly from the project root,
// so the @/ alias is unavailable — use a relative import.

type Row = {
  projectId: number;
  projectName: string;
  scopeItemId: number;
  item: string;
  storedVendor: string | null;
  storedVendorId: number | null;
};

async function main() {
  const lines: Row[] = await db()
    .select({
      projectId: schema.scopeItems.projectId,
      projectName: schema.projects.name,
      scopeItemId: schema.scopeItems.id,
      item: schema.scopeItems.item,
      storedVendor: schema.vendors.name,
      storedVendorId: schema.scopeItems.vendorId,
    })
    .from(schema.scopeItems)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.scopeItems.projectId))
    .leftJoin(schema.vendors, eq(schema.vendors.id, schema.scopeItems.vendorId))
    .where(and(isNull(schema.scopeItems.archivedAt), isNull(schema.projects.archivedAt)));

  const named = lines.filter((l) => l.storedVendorId != null);
  if (named.length === 0) {
    console.log("No scope line carries a vendor. Nothing to reconcile.");
    return;
  }

  // Every approved bid's coverage, in one pass — line id -> awarded vendor.
  const awarded = await db()
    .select({
      scopeItemId: schema.bidLineItems.scopeItemId,
      bidNumber: schema.bids.bidNumber,
      vendorId: schema.bids.vendorId,
      vendorName: schema.vendors.name,
    })
    .from(schema.bidLineItems)
    .innerJoin(schema.bids, eq(schema.bids.id, schema.bidLineItems.bidId))
    .leftJoin(schema.vendors, eq(schema.vendors.id, schema.bids.vendorId))
    .where(and(eq(schema.bids.approved, true), isNull(schema.bids.archivedAt)));

  const coverage = new Map<number, { bidNumber: number; vendorId: number | null; vendorName: string | null }>();
  for (const a of awarded) {
    if (a.scopeItemId == null) continue;
    if (!coverage.has(a.scopeItemId)) {
      coverage.set(a.scopeItemId, {
        bidNumber: a.bidNumber,
        vendorId: a.vendorId,
        vendorName: a.vendorName,
      });
    }
  }

  const unbacked: string[] = [];
  const conflict: string[] = [];

  for (const l of named) {
    const held = coverage.get(l.scopeItemId);
    const where = `${l.projectName} #${l.projectId} · "${l.item}" (line ${l.scopeItemId})`;
    if (!held) {
      unbacked.push(`  ${where}\n      names ${l.storedVendor ?? `vendor ${l.storedVendorId}`}, no approved bid covers it`);
    } else if (held.vendorId !== l.storedVendorId) {
      conflict.push(
        `  ${where}\n      names ${l.storedVendor ?? l.storedVendorId}, but bid #${held.bidNumber} awarded it to ${held.vendorName ?? held.vendorId}`,
      );
    }
  }

  console.log(`${named.length} scope line(s) carry a vendor.\n`);
  console.log(`UNBACKED — ${unbacked.length}`);
  console.log(unbacked.length ? unbacked.join("\n") : "  none");
  console.log(`\nCONFLICT — ${conflict.length}`);
  console.log(conflict.length ? conflict.join("\n") : "  none");

  if (unbacked.length || conflict.length) {
    console.log(
      "\nNothing was changed. An UNBACKED line keeps its vendor until an award covers it;" +
        "\na CONFLICT is overwritten the next time that award is applied.",
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

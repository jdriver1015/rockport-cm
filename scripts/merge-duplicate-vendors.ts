/**
 * One-off: collapse the vendor duplicates surfaced while testing the
 * send-for-bid flow on Aston Post Oak.
 *
 *   npx tsx scripts/merge-duplicate-vendors.ts
 *
 * Two different situations, handled differently:
 *
 * 1. "Ace" (id 2) vs "Ace Nationwide Construction LLC" (id 20) — id 2 is the
 *    real, pre-existing vendor: it already carries a contact named Jeremy
 *    Pierce, who is literally the signatory on the executed Ace Nationwide
 *    contract, and it is in active use on four other properties' unit
 *    interiors. It was entered under a shorthand name before the full legal
 *    name was on file. So id 2 is canonical here, not the one this session
 *    created — its references get REASSIGNED onto id 2, its name is
 *    corrected to the full legal name, and the newer row is removed.
 *
 * 2. "Ace/Felix", "Dodd Creative", "FitLogisitX", "Guy Roofing", "TGO" — each
 *    has zero references anywhere (no contacts, projects, bids, scope items,
 *    or GL rows). These are stray rows with no history to preserve, so they
 *    are just deleted outright; the correctly-named vendor this session
 *    created for each (Dodd CG LLC, FitLogistics, Guy Roofing Inc., TGO
 *    Landscaping Inc.) already carries all the real work.
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { db, schema } from "../src/db";
import { eq } from "drizzle-orm";

async function main() {
  await db().transaction(async (tx) => {
    // 1. Ace Nationwide Construction LLC (20) folds into Ace (2).
    const fromId = 20;
    const toId = 2;
    await tx.update(schema.vendorContacts).set({ vendorId: toId }).where(eq(schema.vendorContacts.vendorId, fromId));
    await tx.update(schema.projects).set({ vendorId: toId }).where(eq(schema.projects.vendorId, fromId));
    await tx.update(schema.bids).set({ vendorId: toId }).where(eq(schema.bids.vendorId, fromId));
    await tx.update(schema.scopeItems).set({ vendorId: toId }).where(eq(schema.scopeItems.vendorId, fromId));
    await tx.update(schema.glTransactions).set({ vendorId: toId }).where(eq(schema.glTransactions.vendorId, fromId));
    // Delete the old name first — vendors.name is unique, so renaming id 2 to
    // match id 20 while id 20 still holds that name would violate it.
    await tx.delete(schema.vendors).where(eq(schema.vendors.id, fromId));
    await tx.update(schema.vendors).set({ name: "Ace Nationwide Construction LLC" }).where(eq(schema.vendors.id, toId));

    // 2. Zero-reference stray rows — deleted outright.
    for (const id of [14, 12, 13, 9, 11]) {
      await tx.delete(schema.vendors).where(eq(schema.vendors.id, id));
    }
  });

  console.log("Merged Ace duplicates and removed 5 unused stray vendor rows.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

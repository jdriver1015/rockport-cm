"use server";

import { revalidatePath } from "next/cache";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import type { ActionResult } from "@/lib/action-result";
import { readBidContract } from "@/lib/contracts";
import { propertyPath, propertyProjectPath } from "@/lib/property-path";
import {
  applyCoverageVendors,
  bidCoveredLineIds,
  clearAwardVendor,
  clearVendorOnLines,
  coveredLineIdsFor,
  overlapMessage,
  overlappingHolders,
  readAwardCoverage,
  recomputeCommittedCost,
  syncProjectVendor,
} from "@/lib/award-coverage";

async function revalidateBids(propertyId: number, projectId: number) {
  const [projPath, base] = await Promise.all([
    propertyProjectPath(propertyId, projectId),
    propertyPath(propertyId),
  ]);
  if (projPath) revalidatePath(projPath);
  if (base) {
    revalidatePath(base);
    revalidatePath(`${base}/budget`);
  }
  revalidatePath("/vendors");
}

// A single priced line on a bid: either tied to a scope item (scopeItemId set)
// or a manual line the vendor added (labor, mobilization, etc.).
const lineSchema = z.object({
  scopeItemId: z.coerce.number().int().positive().nullable().optional(),
  description: z.string().trim().min(1, "Each line needs a description"),
  amount: z.coerce.number("Enter an amount for each line").nonnegative("Amounts can't be negative"),
});

const addBidSchema = z.object({
  propertyId: z.coerce.number().int().positive(),
  projectId: z.coerce.number().int().positive(),
  vendorId: z.coerce.number().int().positive("Choose a vendor"),
  contactId: z.coerce.number().int().positive().nullable().optional(),
  receivedDate: z.string().trim().optional(),
  note: z.string().trim().optional(),
  lines: z.array(lineSchema).min(1, "Add at least one priced line"),
});

type AddBidInput = z.input<typeof addBidSchema>;

async function insertLines(bidId: number, lines: z.infer<typeof addBidSchema>["lines"]) {
  if (lines.length === 0) return;
  await db()
    .insert(schema.bidLineItems)
    .values(
      lines.map((l, i) => ({
        bidId,
        scopeItemId: l.scopeItemId ?? null,
        description: l.description,
        amount: l.amount.toFixed(2),
        sortOrder: i,
      })),
    );
}

export async function addBid(input: AddBidInput): Promise<ActionResult> {
  const parsed = addBidSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const d = parsed.data;

  const project = await db().query.projects.findFirst({
    where: eq(schema.projects.id, d.projectId),
  });
  if (!project || project.propertyId !== d.propertyId) {
    return { ok: false, error: "Project not found" };
  }

  const [{ maxNumber }] = await db()
    .select({ maxNumber: sql<number>`coalesce(max(${schema.bids.bidNumber}), 0)::int` })
    .from(schema.bids)
    .where(eq(schema.bids.projectId, d.projectId));

  const [bid] = await db()
    .insert(schema.bids)
    .values({
      projectId: d.projectId,
      vendorId: d.vendorId,
      submittedByContactId: d.contactId ?? undefined,
      bidNumber: maxNumber + 1,
      receivedDate: d.receivedDate || undefined,
      note: d.note,
    })
    .returning();

  await insertLines(bid.id, d.lines);

  await revalidateBids(d.propertyId, d.projectId);
  return { ok: true };
}

const editBidSchema = addBidSchema.extend({
  id: z.coerce.number().int().positive(),
});

/** Replace a bid's header fields and its full set of line items. */
export async function editBid(input: z.input<typeof editBidSchema>): Promise<ActionResult> {
  const parsed = editBidSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const d = parsed.data;

  const bid = await db().query.bids.findFirst({ where: eq(schema.bids.id, d.id) });
  if (!bid || bid.projectId !== d.projectId) return { ok: false, error: "Bid not found" };

  // Editing an AWARDED bid moves what it holds, and there is no other guard on
  // that: setBidWinner checks overlap at the moment of awarding, but the lines
  // underneath it can be rewritten afterwards. Without this, adding a line
  // another award already holds puts two vendors on the same work — the one
  // state the whole coverage model exists to prevent — and readAwardCoverage
  // would then hide it, since it keeps only the first holder of each line.
  const previousLines = bid.approved ? await bidCoveredLineIds(d.projectId, d.id) : [];
  if (bid.approved) {
    const nextLines = await coveredLineIdsFor(
      d.projectId,
      d.lines.map((l) => l.scopeItemId ?? null),
    );
    if (nextLines.length === 0) {
      return { ok: false, error: "An awarded bid has to cover at least one live scope line" };
    }
    const coverage = await readAwardCoverage(d.projectId, { excludeBidId: d.id });
    const holders = overlappingHolders(coverage, nextLines);
    if (holders.length > 0) {
      const clashes = nextLines.filter((id) => coverage.has(id)).length;
      return { ok: false, error: overlapMessage(holders, clashes) };
    }
  }

  await db().transaction(async (tx) => {
    await tx
      .update(schema.bids)
      .set({
        vendorId: d.vendorId,
        submittedByContactId: d.contactId ?? null,
        receivedDate: d.receivedDate || null,
        note: d.note ?? null,
      })
      .where(eq(schema.bids.id, d.id));
    await tx.delete(schema.bidLineItems).where(eq(schema.bidLineItems.bidId, d.id));
    await tx.insert(schema.bidLineItems).values(
      d.lines.map((l, i) => ({
        bidId: d.id,
        scopeItemId: l.scopeItemId ?? null,
        description: l.description,
        amount: l.amount.toFixed(2),
        sortOrder: i,
      })),
    );

    if (!bid.approved) return;

    // The vendor and the covered lines can both have just changed, so the lines
    // this award used to hold give the vendor up and every award restamps from
    // coverage. Clearing by the OLD set matters: clearAwardVendor would read the
    // new lines and leave a dropped line carrying a vendor nobody contracted,
    // and an edit that only swaps the vendor would leave the old one in place.
    await clearVendorOnLines(d.projectId, previousLines, tx);
    await applyCoverageVendors(d.projectId, tx);
    await syncProjectVendor(d.projectId, { exec: tx });
    // Repricing an awarded bid moves the project's committed cost. Recomputed
    // across every award rather than set to this bid's total — with split awards
    // this bid is only part of what is committed.
    await recomputeCommittedCost(d.projectId, tx);
  });

  await revalidateBids(d.propertyId, d.projectId);
  return { ok: true };
}

export async function deleteBid(input: {
  id: number;
  propertyId: number;
  projectId: number;
}): Promise<ActionResult> {
  const bid = await db().query.bids.findFirst({ where: eq(schema.bids.id, input.id) });
  if (!bid || bid.projectId !== input.projectId) return { ok: false, error: "Bid not found" };
  if (bid.approved) {
    // Awarding another bid no longer displaces this one, so that is not the fix
    // any more: the award has to be taken back explicitly.
    return { ok: false, error: "This bid is awarded — take the award back first" };
  }

  await db()
    .update(schema.bids)
    .set({ archivedAt: new Date() })
    .where(eq(schema.bids.id, input.id));
  await revalidateBids(input.propertyId, input.projectId);
  return { ok: true };
}

/** Reverses deleteBid — used by the delete toast's Undo action. */
export async function restoreBid(input: {
  id: number;
  propertyId: number;
  projectId: number;
}): Promise<ActionResult> {
  const bid = await db().query.bids.findFirst({ where: eq(schema.bids.id, input.id) });
  if (!bid || bid.projectId !== input.projectId) return { ok: false, error: "Bid not found" };

  await db()
    .update(schema.bids)
    .set({ archivedAt: null })
    .where(eq(schema.bids.id, input.id));
  await revalidateBids(input.propertyId, input.projectId);
  return { ok: true };
}

/**
 * Award a bid: it becomes approved, and the scope lines it prices are spoken
 * for.
 *
 * This used to un-approve every other bid on the project — one winner, whole
 * job. A project can let siding to one sub and roofing to another, so what is
 * refused now is not a second award but an *overlapping* one: two vendors
 * contracted for the same line is a fact the system cannot later untangle.
 *
 * Pass `replaceOverlapping` to un-award whatever collides and take the lines.
 * That is the old behaviour, now something you ask for rather than something
 * that happens quietly.
 */
export async function setBidWinner(input: {
  id: number;
  propertyId: number;
  projectId: number;
  replaceOverlapping?: boolean;
}): Promise<ActionResult> {
  const bid = await db().query.bids.findFirst({ where: eq(schema.bids.id, input.id) });
  if (!bid || bid.projectId !== input.projectId) return { ok: false, error: "Bid not found" };
  if (bid.vendorId == null) return { ok: false, error: "Bid has no vendor" };
  if (bid.archivedAt) return { ok: false, error: "That bid was deleted" };

  const project = await db().query.projects.findFirst({
    where: eq(schema.projects.id, input.projectId),
  });
  if (!project || project.propertyId !== input.propertyId) {
    return { ok: false, error: "Project not found" };
  }

  const lineIds = await bidCoveredLineIds(input.projectId, input.id);
  if (lineIds.length === 0) return { ok: false, error: "There is no scope to award" };

  const coverage = await readAwardCoverage(input.projectId, { excludeBidId: input.id });
  const holders = overlappingHolders(coverage, lineIds);

  if (holders.length > 0 && !input.replaceOverlapping) {
    const clashes = lineIds.filter((id) => coverage.has(id)).length;
    return { ok: false, error: overlapMessage(holders, clashes) };
  }

  // All of it or none of it. These used to be five writes after the transaction
  // closed, so a failure part-way left a bid approved with the vendor stamped on
  // nobody's lines and a committed cost from the award it replaced — a state no
  // read path could explain and nothing would retry.
  await db().transaction(async (tx) => {
    if (holders.length > 0) {
      await tx
        .update(schema.bids)
        .set({ approved: false })
        .where(
          inArray(
            schema.bids.id,
            holders.map((h) => h.bidId),
          ),
        );
      // The replaced awards give their lines up first, so a line handed from one
      // sub to another is never left reading as held by both.
      for (const h of holders) await clearAwardVendor(input.projectId, h.bidId, tx);
    }
    await tx.update(schema.bids).set({ approved: true }).where(eq(schema.bids.id, input.id));

    // Restamped from coverage rather than from this bid alone, so a line a
    // replaced award shared with a third, still-live award keeps its vendor.
    await applyCoverageVendors(input.projectId, tx);
    await recomputeCommittedCost(input.projectId, tx);
    await syncProjectVendor(input.projectId, { exec: tx });
  });

  await revalidateBids(input.propertyId, input.projectId);
  return { ok: true };
}

/**
 * Take an award back.
 *
 * Under one-winner-per-project, un-awarding happened as a side effect of
 * awarding someone else. Disjoint awards do not displace each other, so undoing
 * one has to be something you can actually ask for — otherwise a mis-award is
 * permanent.
 */
export async function clearBidWinner(input: {
  id: number;
  propertyId: number;
  projectId: number;
}): Promise<ActionResult> {
  const bid = await db().query.bids.findFirst({ where: eq(schema.bids.id, input.id) });
  if (!bid || bid.projectId !== input.projectId) return { ok: false, error: "Bid not found" };
  if (!bid.approved) return { ok: false, error: "That bid is not awarded" };

  // Only this award's own contract blocks it. Another vendor's signed contract
  // on a different part of the scope has nothing to do with taking this one back.
  if (await readBidContract(input.projectId, input.id)) {
    return { ok: false, error: "Void this award's contract before taking the award back" };
  }

  await db().transaction(async (tx) => {
    await tx.update(schema.bids).set({ approved: false }).where(eq(schema.bids.id, input.id));
    await clearAwardVendor(input.projectId, input.id, tx);
    // Any line a still-live award also holds gets its vendor back.
    await applyCoverageVendors(input.projectId, tx);
    await recomputeCommittedCost(input.projectId, tx);
    // `releasing` lets the project vendor go with the award it came from.
    // Without it, un-awarding the only bid left the project — and the Vendor
    // card on the project screen — still naming a vendor that held nothing.
    await syncProjectVendor(input.projectId, { releasing: bid.vendorId, exec: tx });
  });

  await revalidateBids(input.propertyId, input.projectId);
  return { ok: true };
}

/** Load a bid's line items — used to seed the edit form. */
export async function getBidLines(bidId: number) {
  return db()
    .select()
    .from(schema.bidLineItems)
    .where(eq(schema.bidLineItems.bidId, bidId))
    .orderBy(asc(schema.bidLineItems.sortOrder), asc(schema.bidLineItems.id));
}

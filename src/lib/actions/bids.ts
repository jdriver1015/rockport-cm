"use server";

import { revalidatePath } from "next/cache";
import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import type { ActionResult } from "@/lib/action-result";

function revalidateBids(propertyId: number, projectId: number) {
  revalidatePath(`/properties/${propertyId}/projects/${projectId}`);
  revalidatePath(`/properties/${propertyId}`);
  revalidatePath(`/properties/${propertyId}/budget`);
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

  revalidateBids(d.propertyId, d.projectId);
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
  });

  // If this is the committed winner, keep the project's committed cost in sync.
  if (bid.approved) {
    const total = await bidTotal(d.id);
    await db()
      .update(schema.projects)
      .set({ committedCost: total.toFixed(2) })
      .where(eq(schema.projects.id, d.projectId));
  }

  revalidateBids(d.propertyId, d.projectId);
  return { ok: true };
}

async function bidTotal(bidId: number): Promise<number> {
  const [{ total }] = await db()
    .select({ total: sql<string>`coalesce(sum(${schema.bidLineItems.amount}), 0)` })
    .from(schema.bidLineItems)
    .where(eq(schema.bidLineItems.bidId, bidId));
  return parseFloat(total);
}

export async function deleteBid(input: {
  id: number;
  propertyId: number;
  projectId: number;
}): Promise<ActionResult> {
  const bid = await db().query.bids.findFirst({ where: eq(schema.bids.id, input.id) });
  if (!bid || bid.projectId !== input.projectId) return { ok: false, error: "Bid not found" };
  if (bid.approved) {
    return { ok: false, error: "This bid was marked the winner — pick another winner first" };
  }

  await db()
    .update(schema.bids)
    .set({ archivedAt: new Date() })
    .where(eq(schema.bids.id, input.id));
  revalidateBids(input.propertyId, input.projectId);
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
  revalidateBids(input.propertyId, input.projectId);
  return { ok: true };
}

/**
 * Marking a winner is the assignment step: the bid becomes approved (any
 * prior winner is un-approved) and the project gets the vendor + a committed
 * cost equal to the winning bid's total (sum of its line items) — which feeds
 * the Committed column everywhere it appears.
 */
export async function setBidWinner(input: {
  id: number;
  propertyId: number;
  projectId: number;
}): Promise<ActionResult> {
  const bid = await db().query.bids.findFirst({ where: eq(schema.bids.id, input.id) });
  if (!bid || bid.projectId !== input.projectId) return { ok: false, error: "Bid not found" };
  if (!bid.vendorId) return { ok: false, error: "Bid has no vendor" };

  const project = await db().query.projects.findFirst({
    where: eq(schema.projects.id, input.projectId),
  });
  if (!project || project.propertyId !== input.propertyId) {
    return { ok: false, error: "Project not found" };
  }

  const total = await bidTotal(input.id);

  await db().transaction(async (tx) => {
    await tx
      .update(schema.bids)
      .set({ approved: false })
      .where(eq(schema.bids.projectId, input.projectId));
    await tx.update(schema.bids).set({ approved: true }).where(eq(schema.bids.id, input.id));
    await tx
      .update(schema.projects)
      .set({ vendorId: bid.vendorId, committedCost: total.toFixed(2) })
      .where(eq(schema.projects.id, input.projectId));
  });

  revalidateBids(input.propertyId, input.projectId);
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

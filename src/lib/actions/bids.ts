"use server";

import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import type { ActionResult } from "@/lib/action-result";

function revalidateBids(propertyId: number, projectId: number) {
  revalidatePath(`/properties/${propertyId}/projects/${projectId}`);
  revalidatePath(`/properties/${propertyId}`);
  revalidatePath(`/properties/${propertyId}/budget`);
  revalidatePath(`/properties/${propertyId}/vendors`);
}

const addBidSchema = z.object({
  propertyId: z.coerce.number().int().positive(),
  projectId: z.coerce.number().int().positive(),
  vendorId: z.coerce.number().int().positive("Choose a vendor"),
  contactId: z.coerce.number().int().positive().optional(),
  amount: z.coerce.number().positive("Enter a bid amount"),
  receivedDate: z.string().trim().optional(),
  note: z.string().trim().optional(),
});

export async function addBid(formData: FormData): Promise<ActionResult> {
  const parsed = addBidSchema.safeParse({
    propertyId: formData.get("propertyId"),
    projectId: formData.get("projectId"),
    vendorId: formData.get("vendorId"),
    contactId: formData.get("contactId") || undefined,
    amount: formData.get("amount"),
    receivedDate: formData.get("receivedDate") || undefined,
    note: formData.get("note") || undefined,
  });
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

  await db().insert(schema.bids).values({
    projectId: d.projectId,
    vendorId: d.vendorId,
    submittedByContactId: d.contactId,
    bidNumber: maxNumber + 1,
    amount: d.amount.toFixed(2),
    receivedDate: d.receivedDate || undefined,
    note: d.note,
  });

  revalidateBids(d.propertyId, d.projectId);
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
    return { ok: false, error: "This bid was marked the winner — pick another winner first" };
  }

  await db().delete(schema.bids).where(eq(schema.bids.id, input.id));
  revalidateBids(input.propertyId, input.projectId);
  return { ok: true };
}

/**
 * Marking a winner is the assignment step: the bid becomes approved (any
 * prior winner is un-approved) and the project gets the vendor + a committed
 * cost equal to the winning amount — which feeds the Committed column
 * everywhere it appears.
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

  await db().transaction(async (tx) => {
    await tx
      .update(schema.bids)
      .set({ approved: false })
      .where(eq(schema.bids.projectId, input.projectId));
    await tx.update(schema.bids).set({ approved: true }).where(eq(schema.bids.id, input.id));
    await tx
      .update(schema.projects)
      .set({ vendorId: bid.vendorId, committedCost: bid.amount })
      .where(eq(schema.projects.id, input.projectId));
  });

  revalidateBids(input.propertyId, input.projectId);
  return { ok: true };
}

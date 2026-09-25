"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { requireUser } from "@/lib/auth";
import { canWriteProperty } from "@/lib/auth-rules";
import { propertyPath, propertyProjectPath } from "@/lib/property-path";
import { INLINE_PRICING_METHODS } from "@/lib/pricing";
import {
  activateAgreementRow,
  addAgreementLineRow,
  archiveAgreementRow,
  awardProjectFromAgreementRows,
  createAgreementRow,
  deleteAgreementLineRow,
  endAgreementRow,
  restoreAgreementRow,
  updateAgreementLinesRow,
} from "@/lib/rate-agreements";

/** Thin wrappers. The logic lives in @/lib/rate-agreements so it can be tested. */

async function revalidateGroup(propertyId: number) {
  const base = await propertyPath(propertyId);
  if (base) revalidatePath(`${base}/interiors/types`);
}

const createSchema = z.object({
  propertyId: z.coerce.number().int().positive(),
  budgetGroupId: z.coerce.number().int().positive(),
  vendorId: z.coerce.number().int().positive(),
  name: z.string().trim().optional(),
  seedFromTierDefaults: z.boolean().default(false),
});

export async function createRateAgreement(
  input: z.input<typeof createSchema>,
): Promise<ActionResult<{ agreementId: number }>> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  if (!canWriteProperty(auth.profile.role)) {
    return { ok: false, error: "You don't have permission to manage vendor agreements" };
  }
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const res = await createAgreementRow(parsed.data);
  if (!res.ok) return res;
  await revalidateGroup(parsed.data.propertyId);
  return res;
}

const idSchema = z.object({
  id: z.coerce.number().int().positive(),
  propertyId: z.coerce.number().int().positive(),
});

export async function activateRateAgreement(input: z.input<typeof idSchema>): Promise<ActionResult> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  if (!canWriteProperty(auth.profile.role)) {
    return { ok: false, error: "You don't have permission to manage vendor agreements" };
  }
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const res = await activateAgreementRow(parsed.data.id, parsed.data.propertyId);
  if (!res.ok) return res;
  await revalidateGroup(parsed.data.propertyId);
  return { ok: true };
}

export async function endRateAgreement(input: z.input<typeof idSchema>): Promise<ActionResult> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  if (!canWriteProperty(auth.profile.role)) {
    return { ok: false, error: "You don't have permission to manage vendor agreements" };
  }
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const res = await endAgreementRow(parsed.data.id, parsed.data.propertyId);
  if (!res.ok) return res;
  await revalidateGroup(parsed.data.propertyId);
  return { ok: true };
}

export async function archiveRateAgreement(input: z.input<typeof idSchema>): Promise<ActionResult> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  if (!canWriteProperty(auth.profile.role)) {
    return { ok: false, error: "You don't have permission to manage vendor agreements" };
  }
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const res = await archiveAgreementRow(parsed.data.id, parsed.data.propertyId);
  if (!res.ok) return res;
  await revalidateGroup(parsed.data.propertyId);
  return { ok: true };
}

export async function restoreRateAgreement(input: z.input<typeof idSchema>): Promise<ActionResult> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  if (!canWriteProperty(auth.profile.role)) {
    return { ok: false, error: "You don't have permission to manage vendor agreements" };
  }
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const res = await restoreAgreementRow(parsed.data.id, parsed.data.propertyId);
  if (!res.ok) return res;
  await revalidateGroup(parsed.data.propertyId);
  return { ok: true };
}

const addLineSchema = z.object({
  agreementId: z.coerce.number().int().positive(),
  propertyId: z.coerce.number().int().positive(),
  costCodeId: z.coerce.number().int().positive(),
});

export async function addRateAgreementLine(
  input: z.input<typeof addLineSchema>,
): Promise<ActionResult> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  if (!canWriteProperty(auth.profile.role)) {
    return { ok: false, error: "You don't have permission to manage vendor agreements" };
  }
  const parsed = addLineSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const res = await addAgreementLineRow(parsed.data);
  if (!res.ok) return res;
  await revalidateGroup(parsed.data.propertyId);
  return { ok: true };
}

const deleteLineSchema = z.object({
  id: z.coerce.number().int().positive(),
  propertyId: z.coerce.number().int().positive(),
});

export async function deleteRateAgreementLine(
  input: z.input<typeof deleteLineSchema>,
): Promise<ActionResult> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  if (!canWriteProperty(auth.profile.role)) {
    return { ok: false, error: "You don't have permission to manage vendor agreements" };
  }
  const parsed = deleteLineSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const res = await deleteAgreementLineRow(parsed.data);
  if (!res.ok) return res;
  await revalidateGroup(parsed.data.propertyId);
  return { ok: true };
}

const updateLinesSchema = z.object({
  agreementId: z.coerce.number().int().positive(),
  propertyId: z.coerce.number().int().positive(),
  lines: z
    .array(
      z.object({
        costCodeId: z.coerce.number().int().positive(),
        pricingMethod: z.enum(INLINE_PRICING_METHODS),
        unitPrice: z.coerce.number().nonnegative("Price must be zero or more"),
      }),
    )
    .min(1, "Nothing to save"),
});

export async function updateRateAgreementLines(
  input: z.input<typeof updateLinesSchema>,
): Promise<ActionResult<{ updated: number }>> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  if (!canWriteProperty(auth.profile.role)) {
    return { ok: false, error: "You don't have permission to manage vendor agreements" };
  }
  const parsed = updateLinesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const res = await updateAgreementLinesRow(parsed.data);
  if (!res.ok) return res;
  await revalidateGroup(parsed.data.propertyId);
  return res;
}

const awardSchema = z.object({
  propertyId: z.coerce.number().int().positive(),
  projectId: z.coerce.number().int().positive(),
  agreementId: z.coerce.number().int().positive(),
  reason: z.string().trim().min(1, "Say why this is awarded under the agreement"),
});

export async function awardFromRateAgreement(
  input: z.input<typeof awardSchema>,
): Promise<ActionResult<{ bidId: number }>> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  if (!canWriteProperty(auth.profile.role)) {
    return { ok: false, error: "You don't have permission to award this project" };
  }
  const parsed = awardSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const d = parsed.data;
  const res = await awardProjectFromAgreementRows(d.projectId, d.agreementId, d.reason);
  if (!res.ok) return res;
  const path = await propertyProjectPath(d.propertyId, d.projectId);
  if (path) revalidatePath(path);
  return { ok: true, bidId: res.bidId };
}

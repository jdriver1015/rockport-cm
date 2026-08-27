"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import type { ActionResult } from "@/lib/action-result";
import { createClient } from "@/lib/supabase/server";
import { propertyPath } from "@/lib/property-path";
import {
  issueBidToken,
  revokeBidToken,
  saveDraftPrices,
  submitPortalBid,
} from "@/lib/bid-portal";

// ---------------------------------------------------------------------------
// Two audiences in one file, which is worth being explicit about.
//
// submitBidPrices is called from the PUBLIC portal: it has no session, and the
// token is the only authorisation. It never accepts a bid id — only the token,
// which it re-resolves itself.
//
// issueLink and revokeLink are internal: they take a bid id and require a signed-in
// user.
// ---------------------------------------------------------------------------

const submitSchema = z.object({
  token: z.string().trim().min(20).max(64),
  amounts: z
    .array(
      z.object({
        lineId: z.coerce.number().int().positive(),
        // Negative prices are not a thing, and a cap keeps a fat-fingered paste
        // from landing a nine-figure bid.
        amount: z.coerce.number().min(0).max(99_999_999),
      }),
    )
    .min(1)
    .max(500),
  note: z.string().trim().max(2000).optional(),
});

/** Public: record a vendor's prices. The token is the only credential. */
export async function submitBidPrices(
  input: z.input<typeof submitSchema>,
): Promise<ActionResult<{ total: number }>> {
  const parsed = submitSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { token, amounts, note } = parsed.data;

  const res = await submitPortalBid(token, amounts, note ?? null);
  if (!res.ok) return res;

  // Refresh the vendor's own page. The internal project page is not revalidated
  // from here — a public caller should not be able to make the app do work on
  // paths it knows nothing about.
  revalidatePath(`/bid/${token}`);
  return { ok: true, total: res.total };
}

const linkSchema = z.object({
  bidId: z.coerce.number().int().positive(),
  projectId: z.coerce.number().int().positive(),
});

async function requireSession(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

async function revalidateProject(projectId: number) {
  const project = await db().query.projects.findFirst({
    where: eq(schema.projects.id, projectId),
    columns: { propertyId: true },
  });
  if (!project) return;
  const base = await propertyPath(project.propertyId);
  if (base) revalidatePath(`${base}/projects/${projectId}`);
}

/** Internal: mint a link for a bid, revoking any previous one. */
export async function issueLink(
  input: z.input<typeof linkSchema>,
): Promise<ActionResult<{ token: string; expiresAt: string }>> {
  const parsed = linkSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const userId = await requireSession();
  if (!userId) return { ok: false, error: "Sign in to create a bid link" };

  // The bid must belong to the project the caller named, or a bid id from
  // anywhere could have a link minted for it.
  const bid = await db().query.bids.findFirst({
    where: eq(schema.bids.id, parsed.data.bidId),
    columns: { projectId: true },
  });
  if (!bid || bid.projectId !== parsed.data.projectId) {
    return { ok: false, error: "Bid not found on this project" };
  }

  const { token, expiresAt } = await issueBidToken(parsed.data.bidId, userId);
  await revalidateProject(parsed.data.projectId);
  return { ok: true, token, expiresAt: expiresAt.toISOString() };
}

/** Internal: kill a bid's link. */
export async function revokeLink(input: z.input<typeof linkSchema>): Promise<ActionResult> {
  const parsed = linkSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const userId = await requireSession();
  if (!userId) return { ok: false, error: "Sign in to revoke a bid link" };

  const bid = await db().query.bids.findFirst({
    where: eq(schema.bids.id, parsed.data.bidId),
    columns: { projectId: true },
  });
  if (!bid || bid.projectId !== parsed.data.projectId) {
    return { ok: false, error: "Bid not found on this project" };
  }

  await revokeBidToken(parsed.data.bidId);
  await revalidateProject(parsed.data.projectId);
  return { ok: true };
}

const draftSchema = z.object({
  token: z.string().min(10),
  amounts: z.array(z.object({ lineId: z.coerce.number().int().positive(), amount: z.coerce.number() })),
});

/**
 * Save a vendor's working prices.
 *
 * No revalidatePath: the vendor is mid-typing, and re-rendering the page under
 * them would move the cursor. Our side sees it on its next load.
 */
export async function saveBidDraft(
  input: z.input<typeof draftSchema>,
): Promise<ActionResult<{ saved: number }>> {
  const parsed = draftSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const res = await saveDraftPrices(parsed.data.token, parsed.data.amounts);
  if (!res.ok) return res;
  return { ok: true, saved: res.saved };
}

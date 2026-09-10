"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/action-result";
import { propertyProjectPath } from "@/lib/property-path";

/**
 * Files filed against a bid — the vendor's own quote PDF, an insurance
 * certificate, whatever came in outside the portal. Soft-delete, same as the
 * project-level documents: the storage object is kept so this is reversible,
 * and only a hard purge would ever touch it.
 */
export async function deleteBidAttachment(input: {
  id: number;
  propertyId: number;
  projectId: number;
}): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const row = await db().query.attachments.findFirst({
    where: and(
      eq(schema.attachments.id, input.id),
      eq(schema.attachments.projectId, input.projectId),
    ),
  });
  if (!row || row.bidId == null) return { ok: false, error: "Attachment not found" };

  await db()
    .update(schema.attachments)
    .set({ archivedAt: new Date() })
    .where(eq(schema.attachments.id, input.id));

  const path = await propertyProjectPath(input.propertyId, input.projectId);
  if (path) revalidatePath(path);
  return { ok: true };
}

/** Reverses deleteBidAttachment — used by the delete toast's Undo action. */
export async function restoreBidAttachment(input: {
  id: number;
  propertyId: number;
  projectId: number;
}): Promise<ActionResult> {
  const row = await db().query.attachments.findFirst({
    where: and(
      eq(schema.attachments.id, input.id),
      eq(schema.attachments.projectId, input.projectId),
    ),
  });
  if (!row || row.bidId == null) return { ok: false, error: "Attachment not found" };

  await db()
    .update(schema.attachments)
    .set({ archivedAt: null })
    .where(eq(schema.attachments.id, input.id));

  const path = await propertyProjectPath(input.propertyId, input.projectId);
  if (path) revalidatePath(path);
  return { ok: true };
}

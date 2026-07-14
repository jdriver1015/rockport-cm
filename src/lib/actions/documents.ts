"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/action-result";

/**
 * Soft-delete — the storage file is kept (not removed) so this is fully
 * reversible via restoreDocument; only a hard purge would ever touch storage.
 */
export async function deleteDocument(input: {
  id: number;
  propertyId: number;
  projectId: number;
}): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const doc = await db().query.attachments.findFirst({
    where: and(
      eq(schema.attachments.id, input.id),
      eq(schema.attachments.projectId, input.projectId),
    ),
  });
  if (!doc) return { ok: false, error: "Document not found" };

  await db()
    .update(schema.attachments)
    .set({ archivedAt: new Date() })
    .where(eq(schema.attachments.id, input.id));

  revalidatePath(`/properties/${input.propertyId}/projects/${input.projectId}`);
  return { ok: true };
}

/** Reverses deleteDocument — used by the delete toast's Undo action. */
export async function restoreDocument(input: {
  id: number;
  propertyId: number;
  projectId: number;
}): Promise<ActionResult> {
  const doc = await db().query.attachments.findFirst({
    where: and(
      eq(schema.attachments.id, input.id),
      eq(schema.attachments.projectId, input.projectId),
    ),
  });
  if (!doc) return { ok: false, error: "Document not found" };

  await db()
    .update(schema.attachments)
    .set({ archivedAt: null })
    .where(eq(schema.attachments.id, input.id));

  revalidatePath(`/properties/${input.propertyId}/projects/${input.projectId}`);
  return { ok: true };
}

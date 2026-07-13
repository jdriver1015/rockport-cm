"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { createClient } from "@/lib/supabase/server";
import { ATTACHMENTS_BUCKET, createAdminClient } from "@/lib/supabase/admin";
import type { ActionResult } from "@/lib/action-result";

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

  const admin = createAdminClient();
  await admin.storage.from(ATTACHMENTS_BUCKET).remove([doc.storagePath]);
  await db().delete(schema.attachments).where(eq(schema.attachments.id, input.id));

  revalidatePath(`/properties/${input.propertyId}/projects/${input.projectId}`);
  return { ok: true };
}

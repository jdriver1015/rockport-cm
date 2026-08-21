"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import type { ActionResult } from "@/lib/action-result";
import { propertyPath } from "@/lib/property-path";
import { sendBidPackageRows } from "@/lib/bid-package";

// ---------------------------------------------------------------------------
// Validation and revalidation around src/lib/bid-package.ts.
// ---------------------------------------------------------------------------

const sendSchema = z.object({
  projectId: z.coerce.number().int().positive(),
  vendorIds: z.array(z.coerce.number().int().positive()).min(1, "Pick at least one vendor").max(50),
  scopeItemIds: z
    .array(z.coerce.number().int().positive())
    .min(1, "Pick at least one scope item")
    .max(500),
});

export async function sendBidPackage(
  input: z.input<typeof sendSchema>,
): Promise<ActionResult<{ sent: number; skipped: number }>> {
  const parsed = sendSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { projectId, vendorIds, scopeItemIds } = parsed.data;

  const res = await sendBidPackageRows(projectId, vendorIds, scopeItemIds);
  if (!res.ok) return res;

  const project = await db().query.projects.findFirst({
    where: eq(schema.projects.id, projectId),
    columns: { propertyId: true },
  });
  if (project) {
    const base = await propertyPath(project.propertyId);
    if (base) revalidatePath(`${base}/projects/${projectId}`);
  }

  return { ok: true, sent: res.sent, skipped: res.skipped.length };
}

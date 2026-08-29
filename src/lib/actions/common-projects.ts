"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { createCommonProjectRows } from "@/lib/common-project";
import type { CreateCommonProjectInput } from "@/lib/common-project";
import type { ActionResult } from "@/lib/action-result";

/**
 * Auth and revalidation around createCommonProjectRows.
 *
 * Same split as scope-confirm and bid-package: requireUser reads cookies, which
 * only exist inside a request, so the work it guards lives in a plain module a
 * probe can drive.
 */
export async function createCommonProject(
  input: CreateCommonProjectInput,
): Promise<ActionResult<{ projectId: number; slug: string }>> {
  const auth = await requireUser();
  if (!auth.ok) return auth;

  const res = await createCommonProjectRows(input);
  if (!res.ok) return res;

  const base = `/properties/${res.propertySlug}`;
  revalidatePath(base);
  revalidatePath(`${base}/projects/${res.slug}`);

  return { ok: true, projectId: res.projectId, slug: res.slug };
}

"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import type { ActionResult } from "@/lib/action-result";
import { propertyProjectPath } from "@/lib/property-path";
import {
  confirmScopeRows,
  directAwardRows,
  unconfirmScopeRows,
  withdrawRfpsRows,
} from "@/lib/scope-confirm";

/** Thin wrappers. The logic lives in @/lib/scope-confirm so it can be tested. */

async function revalidateProject(projectId: number) {
  const project = await db().query.projects.findFirst({
    where: eq(schema.projects.id, projectId),
    columns: { propertyId: true },
  });
  if (!project) return false;
  const path = await propertyProjectPath(project.propertyId, projectId);
  if (path) revalidatePath(path);
  return true;
}

const idSchema = z.object({ projectId: z.coerce.number().int().positive() });

export async function confirmScope(input: z.input<typeof idSchema>): Promise<ActionResult> {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const res = await confirmScopeRows(parsed.data.projectId);
  if (!res.ok) return res;
  if (!(await revalidateProject(parsed.data.projectId))) {
    return { ok: false, error: "Project not found" };
  }
  return { ok: true };
}

export async function unconfirmScope(input: z.input<typeof idSchema>): Promise<ActionResult> {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const res = await unconfirmScopeRows(parsed.data.projectId);
  if (!res.ok) return res;
  await revalidateProject(parsed.data.projectId);
  return { ok: true };
}

export async function withdrawRfps(
  input: z.input<typeof idSchema>,
): Promise<ActionResult<{ withdrawn: number; tokensRevoked: number }>> {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const res = await withdrawRfpsRows(parsed.data.projectId);
  if (!res.ok) return res;
  await revalidateProject(parsed.data.projectId);
  return { ok: true, withdrawn: res.withdrawn, tokensRevoked: res.tokensRevoked };
}

const directSchema = z.object({
  projectId: z.coerce.number().int().positive(),
  vendorId: z.coerce.number().int().positive(),
  amount: z.string().trim().min(1, "Enter an amount"),
  reason: z.string().trim().min(1, "Say why this is not going out for bid"),
});

export async function directAward(
  input: z.input<typeof directSchema>,
): Promise<ActionResult<{ bidId: number }>> {
  const parsed = directSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const d = parsed.data;
  const res = await directAwardRows(d.projectId, d.vendorId, d.amount, d.reason);
  if (!res.ok) return res;
  await revalidateProject(d.projectId);
  return { ok: true, bidId: res.bidId };
}

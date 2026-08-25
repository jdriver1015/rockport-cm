"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import type { ActionResult } from "@/lib/action-result";
import { propertyProjectPath } from "@/lib/property-path";
import { advanceContractRow, generateContractRow } from "@/lib/contracts";

/** Thin wrappers. The logic lives in @/lib/contracts so it can be tested. */

async function revalidateProject(projectId: number) {
  const project = await db().query.projects.findFirst({
    where: eq(schema.projects.id, projectId),
    columns: { propertyId: true },
  });
  if (!project) return;
  const path = await propertyProjectPath(project.propertyId, projectId);
  if (path) revalidatePath(path);
}

const generateSchema = z.object({
  projectId: z.coerce.number().int().positive(),
  /** The awarded bid to contract for — a split job has one per vendor. */
  bidId: z.coerce.number().int().positive(),
});

export async function generateContract(
  input: z.input<typeof generateSchema>,
): Promise<ActionResult<{ contractId: number }>> {
  const parsed = generateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const res = await generateContractRow(parsed.data.bidId);
  if (!res.ok) return res;
  await revalidateProject(parsed.data.projectId);
  return { ok: true, contractId: res.contractId };
}

const stepSchema = z.object({
  projectId: z.coerce.number().int().positive(),
  contractId: z.coerce.number().int().positive(),
  to: z.enum(["out_for_signature", "vendor_signed", "executed", "voided"]),
});

export async function advanceContract(
  input: z.input<typeof stepSchema>,
): Promise<ActionResult> {
  const parsed = stepSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const res = await advanceContractRow(parsed.data.projectId, parsed.data.contractId, parsed.data.to);
  if (!res.ok) return res;
  await revalidateProject(parsed.data.projectId);
  return { ok: true };
}

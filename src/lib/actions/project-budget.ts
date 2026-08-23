"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import type { ActionResult } from "@/lib/action-result";
import { propertyProjectPath } from "@/lib/property-path";
import { setProjectBudgetRow } from "@/lib/project-budget";

/** Thin wrapper. The logic lives in @/lib/project-budget so it can be tested. */

const schemaIn = z.object({
  projectId: z.coerce.number().int().positive(),
  budgetAmount: z.string().trim(),
  /** Absent leaves the code alone; empty string clears it. */
  costCodeId: z.string().trim().optional(),
});

export async function setProjectBudget(
  input: z.input<typeof schemaIn>,
): Promise<ActionResult> {
  const parsed = schemaIn.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const d = parsed.data;

  const amount = d.budgetAmount === "" ? 0 : Number(d.budgetAmount);
  const code =
    d.costCodeId === undefined ? undefined : d.costCodeId === "" ? null : Number(d.costCodeId);
  if (code != null && !Number.isInteger(code)) return { ok: false, error: "Invalid cost code" };

  const res = await setProjectBudgetRow(d.projectId, amount, code);
  if (!res.ok) return res;

  const project = await db().query.projects.findFirst({
    where: eq(schema.projects.id, d.projectId),
    columns: { propertyId: true },
  });
  if (project) {
    const path = await propertyProjectPath(project.propertyId, d.projectId);
    if (path) revalidatePath(path);
  }
  return { ok: true };
}

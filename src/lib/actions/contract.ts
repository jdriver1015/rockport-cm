"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import type { ActionResult } from "@/lib/action-result";
import { propertyPath } from "@/lib/property-path";

// ---------------------------------------------------------------------------
// The contract: the fourth pre-con gate.
//
// Today this records one fact — the date the contract was signed — against the
// bid it was signed for. That is deliberately less than the eventual flow (a
// generated document, a template, a countersignature), and it is the fact all
// of those end in, so nothing here needs replacing when they arrive.
//
// Signing requires an awarded bid. A contract with no selected vendor and no
// agreed price is not a contract, and letting the gate be satisfied without one
// would make the four gates independently clickable rather than sequential.
// ---------------------------------------------------------------------------

const signSchema = z.object({
  projectId: z.coerce.number().int().positive(),
  /** Empty un-signs — a date entered by mistake has to be removable. */
  signedAt: z.string().trim().optional(),
});

export async function signContract(input: z.input<typeof signSchema>): Promise<ActionResult> {
  const parsed = signSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { projectId, signedAt } = parsed.data;

  const project = await db().query.projects.findFirst({
    where: eq(schema.projects.id, projectId),
    columns: { propertyId: true },
  });
  if (!project) return { ok: false, error: "Project not found" };

  if (signedAt) {
    const awarded = await db().query.bids.findFirst({
      where: and(
        eq(schema.bids.projectId, projectId),
        eq(schema.bids.approved, true),
        isNull(schema.bids.archivedAt),
      ),
      columns: { id: true },
    });
    if (!awarded) {
      return { ok: false, error: "Select a winning bid before recording a signed contract" };
    }
  }

  await db()
    .update(schema.projects)
    .set({ contractSignedAt: signedAt ? signedAt : null })
    .where(eq(schema.projects.id, projectId));

  const base = await propertyPath(project.propertyId);
  if (base) revalidatePath(`${base}/projects/${projectId}`);
  return { ok: true };
}

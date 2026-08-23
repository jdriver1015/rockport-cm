"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import type { ActionResult } from "@/lib/action-result";

const saveSchema = z.object({
  id: z.coerce.number().int().positive(),
  name: z.string().trim().min(1, "Give the template a name"),
  body: z.string().trim().min(1, "The template cannot be empty"),
  /**
   * What the editor loaded. An integer, not a timestamp: timestamptz comes back
   * with microseconds that a JS Date cannot round-trip, so comparing them
   * refuses every save.
   */
  version: z.coerce.number().int().nonnegative(),
});

/**
 * Save the template.
 *
 * Compare-and-set on version, because two people editing the terms and the
 * last one silently winning is how a clause disappears. Editing does not touch
 * contracts already generated — those carry their own snapshot.
 */
export async function saveContractTemplate(
  input: z.input<typeof saveSchema>,
): Promise<ActionResult> {
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const d = parsed.data;

  const updated = await db()
    .update(schema.contractTemplates)
    .set({ name: d.name, body: d.body, version: d.version + 1, updatedAt: new Date() })
    .where(
      and(eq(schema.contractTemplates.id, d.id), eq(schema.contractTemplates.version, d.version)),
    )
    .returning({ id: schema.contractTemplates.id });

  if (updated.length === 0) {
    const exists = await db().query.contractTemplates.findFirst({
      where: eq(schema.contractTemplates.id, d.id),
      columns: { id: true },
    });
    return {
      ok: false,
      error: exists
        ? "Someone else saved this template while you were editing. Reload to see their version."
        : "Template not found",
    };
  }

  revalidatePath("/settings/contract-template");
  return { ok: true };
}

const createSchema = z.object({
  name: z.string().trim().min(1, "Give the template a name"),
  body: z.string().trim().min(1, "The template cannot be empty"),
});

export async function createContractTemplate(
  input: z.input<typeof createSchema>,
): Promise<ActionResult<{ id: number }>> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const existing = await db().query.contractTemplates.findFirst({
    where: isNull(schema.contractTemplates.archivedAt),
    columns: { id: true },
  });
  const [row] = await db()
    .insert(schema.contractTemplates)
    .values({ ...parsed.data, isDefault: !existing })
    .returning({ id: schema.contractTemplates.id });
  revalidatePath("/settings/contract-template");
  return { ok: true, id: row.id };
}

const defaultSchema = z.object({ id: z.coerce.number().int().positive() });

/** Make one template the default. Exactly one, in a transaction. */
export async function setDefaultContractTemplate(
  input: z.input<typeof defaultSchema>,
): Promise<ActionResult> {
  const parsed = defaultSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  // Clearing first is not optional — a partial unique index enforces one
  // default, so setting a second without clearing the first fails outright.
  await db().transaction(async (tx) => {
    await tx
      .update(schema.contractTemplates)
      .set({ isDefault: false })
      .where(eq(schema.contractTemplates.isDefault, true));
    await tx
      .update(schema.contractTemplates)
      .set({ isDefault: true })
      .where(eq(schema.contractTemplates.id, parsed.data.id));
  });

  revalidatePath("/settings/contract-template");
  return { ok: true };
}

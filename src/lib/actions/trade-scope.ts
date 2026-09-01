"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { propertyPath } from "@/lib/property-path";
import {
  copyTradeScopeRows,
  removeTradeScope,
  writeTradeScope,
  type ScopeOwnerRef,
} from "@/lib/trade-scope-store";

// ---------------------------------------------------------------------------
// Written trade scope, at both levels. These are validation and revalidation
// around src/lib/trade-scope-store.ts, which holds the database work.
// ---------------------------------------------------------------------------

const ownerSchema = z.discriminatedUnion("level", [
  z.object({ level: z.literal("template"), templateId: z.coerce.number().int().positive() }),
  z.object({
    level: z.literal("group"),
    budgetGroupId: z.coerce.number().int().positive(),
    /** Needed only to revalidate the right property page. */
    propertyId: z.coerce.number().int().positive(),
  }),
]);

async function revalidateOwner(owner: ScopeOwnerRef) {
  if (owner.level === "template") {
    revalidatePath(`/settings/renovation-types/${owner.templateId}`);
    return;
  }
  // The renovation type's own page is what renders this, not the retired
  // Turn Plan tab.
  const path = await propertyPath(owner.propertyId, `/interiors/types/${owner.budgetGroupId}`);
  if (path) revalidatePath(path);
}

const saveSchema = z.object({
  owner: ownerSchema,
  heading: z.string().trim().min(1, "A trade name is required").max(80),
  body: z.string().max(20_000).optional().nullable(),
});

/** Write or rewrite one trade's scope. Clearing the text removes it. */
export async function saveTradeScope(
  input: z.input<typeof saveSchema>,
): Promise<ActionResult<{ written: boolean }>> {
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { owner, heading, body } = parsed.data;

  const { written } = await writeTradeScope(owner, heading, body);
  await revalidateOwner(owner);
  return { ok: true, written };
}

const deleteSchema = z.object({ owner: ownerSchema, heading: z.string().trim().min(1) });

/** Remove a trade's scope entirely. A standard heading reverts to unwritten. */
export async function deleteTradeScope(
  input: z.input<typeof deleteSchema>,
): Promise<ActionResult> {
  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  await removeTradeScope(parsed.data.owner, parsed.data.heading);
  await revalidateOwner(parsed.data.owner);
  return { ok: true };
}

const copySchema = z.object({
  to: ownerSchema,
  from: ownerSchema,
  /** Replace scopes already written on the target. Off by default. */
  overwrite: z.coerce.boolean().default(false),
});

/** Copy one owner's written scopes onto another, skipping what the target wrote. */
export async function copyTradeScopes(
  input: z.input<typeof copySchema>,
): Promise<ActionResult<{ copied: number; skipped: number }>> {
  const parsed = copySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { from, to, overwrite } = parsed.data;

  const res = await copyTradeScopeRows(to, from, overwrite);
  if (!res.ok) return res;

  await revalidateOwner(to);
  return { ok: true, copied: res.copied, skipped: res.skipped };
}

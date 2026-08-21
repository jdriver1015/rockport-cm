"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { propertyPath } from "@/lib/property-path";
import { SPEC_KINDS } from "@/lib/spec-tables";
import {
  copySpecTables,
  createSpecTable,
  deleteSpecTable,
  renameSpecTable,
  saveSpecGrid,
} from "@/lib/spec-tables-store";
import type { ScopeOwnerRef } from "@/lib/trade-scope-store";

// ---------------------------------------------------------------------------
// Finish specs and fixture kit. Validation and revalidation around
// src/lib/spec-tables-store.ts.
// ---------------------------------------------------------------------------

const ownerSchema = z.discriminatedUnion("level", [
  z.object({ level: z.literal("template"), templateId: z.coerce.number().int().positive() }),
  z.object({
    level: z.literal("group"),
    budgetGroupId: z.coerce.number().int().positive(),
    propertyId: z.coerce.number().int().positive(),
  }),
]);

const gridSchema = z.object({
  cols: z.array(z.string().max(60)).max(12),
  rows: z.array(z.array(z.string().max(600)).max(12)).max(400),
});

async function revalidateOwner(owner: ScopeOwnerRef) {
  if (owner.level === "template") {
    revalidatePath(`/settings/renovation-types/${owner.templateId}`);
    return;
  }
  const path = await propertyPath(owner.propertyId, "/interiors");
  if (path) revalidatePath(path);
}

const addSchema = z.object({
  owner: ownerSchema,
  kind: z.enum(SPEC_KINDS),
  title: z.string().trim().min(1, "A table name is required").max(60),
  cols: z.array(z.string().trim().min(1).max(60)).min(1, "At least one column").max(12),
});

/** Add a spec table. A title already present here is returned rather than duplicated. */
export async function addSpecTable(
  input: z.input<typeof addSchema>,
): Promise<ActionResult<{ id: number; created: boolean }>> {
  const parsed = addSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { owner, kind, title, cols } = parsed.data;

  const res = await createSpecTable(owner, kind, title, cols);
  await revalidateOwner(owner);
  return { ok: true, ...res };
}

const saveSchema = z.object({
  owner: ownerSchema,
  id: z.coerce.number().int().positive(),
  grid: gridSchema,
  /** The version the editor loaded, for the compare-and-set. */
  expectedVersion: z.coerce.number().int().positive().optional(),
});

/** Replace one table's grid. Blank rows are dropped. */
export async function saveSpecTableGrid(
  input: z.input<typeof saveSchema>,
): Promise<ActionResult> {
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { owner, id, grid, expectedVersion } = parsed.data;

  const res = await saveSpecGrid(owner, id, grid, expectedVersion);
  if (!res.ok) {
    return {
      ok: false,
      error: res.conflict
        ? "Someone else saved this table while you were editing — reload to see their changes before saving yours."
        : "That spec table no longer exists",
    };
  }
  await revalidateOwner(owner);
  return { ok: true };
}

const renameSchema = z.object({
  owner: ownerSchema,
  id: z.coerce.number().int().positive(),
  title: z.string().trim().min(1, "A table name is required").max(60),
});

/** Rename a spec table. */
export async function renameSpecTableAction(
  input: z.input<typeof renameSchema>,
): Promise<ActionResult> {
  const parsed = renameSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { owner, id, title } = parsed.data;

  const res = await renameSpecTable(owner, id, title);
  if (!res.ok) return { ok: false, error: res.reason ?? "Could not rename that table" };
  await revalidateOwner(owner);
  return { ok: true };
}

const removeSchema = z.object({
  owner: ownerSchema,
  id: z.coerce.number().int().positive(),
});

/** Remove a spec table and its rows. */
export async function removeSpecTable(input: z.input<typeof removeSchema>): Promise<ActionResult> {
  const parsed = removeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const res = await deleteSpecTable(parsed.data.owner, parsed.data.id);
  if (!res.ok) return { ok: false, error: "That spec table no longer exists" };
  await revalidateOwner(parsed.data.owner);
  return { ok: true };
}

const copySchema = z.object({
  to: ownerSchema,
  from: ownerSchema,
  overwrite: z.coerce.boolean().default(false),
});

/** Copy spec tables between levels, skipping titles the target already has. */
export async function copySpecTablesAction(
  input: z.input<typeof copySchema>,
): Promise<ActionResult<{ copied: number; skipped: number }>> {
  const parsed = copySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { from, to, overwrite } = parsed.data;

  const res = await copySpecTables(to, from, overwrite);
  if (!res.ok) return res;
  await revalidateOwner(to);
  return { ok: true, copied: res.copied, skipped: res.skipped };
}

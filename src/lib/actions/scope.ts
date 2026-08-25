"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import type { ActionResult } from "@/lib/action-result";
import { propertyProjectPath } from "@/lib/property-path";
import {
  checkScopeEditable,
  checkScopeStructureEditable,
  scopeItemProjectId,
} from "@/lib/scope-lock";

async function revalidateProject(propertyId: number, projectId: number) {
  const path = await propertyProjectPath(propertyId, projectId);
  if (path) revalidatePath(path);
}

const optionalNumeric = z
  .string()
  .trim()
  .nullish()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || !Number.isNaN(Number(v)), "Enter a valid number");

/** Product spec grid: rows are cell arrays parallel to cols. */
const specsSchema = z.object({
  cols: z.array(z.string()),
  rows: z.array(z.array(z.string())),
});

const optionalDate = z
  .string()
  .trim()
  .nullish()
  .transform((v) => (v ? v : null));

const createSchema = z.object({
  propertyId: z.coerce.number().int().positive(),
  projectId: z.coerce.number().int().positive(),
  item: z.string().trim().min(1, "Item is required"),
  materialQuality: z
    .string()
    .trim()
    .nullish()
    .transform((v) => (v ? v : null)),
  quantity: optionalNumeric,
  unitPrice: optionalNumeric,
  costCodeId: z.number().int().positive().nullish(),
  startDate: optionalDate,
  endDate: optionalDate,
  specs: specsSchema.nullish(),
});

/** Creates a scope item and returns its id — the caller keeps editing that row inline once it exists. */
export async function createScopeItem(
  input: z.input<typeof createSchema>,
): Promise<ActionResult<{ id: number }>> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const d = parsed.data;

  const locked = await checkScopeStructureEditable(d.projectId);
  if (locked) return { ok: false, error: locked };

  const [{ maxOrder }] = await db()
    .select({ maxOrder: sql<number>`coalesce(max(${schema.scopeItems.sortOrder}), 0)::int` })
    .from(schema.scopeItems)
    .where(eq(schema.scopeItems.projectId, d.projectId));

  const [row] = await db()
    .insert(schema.scopeItems)
    .values({
      projectId: d.projectId,
      item: d.item,
      materialQuality: d.materialQuality,
      quantity: d.quantity,
      unitPrice: d.unitPrice,
      costCodeId: d.costCodeId ?? null,
      startDate: d.startDate,
      endDate: d.endDate,
      specs: d.specs ?? null,
      sortOrder: maxOrder + 1,
    })
    .returning({ id: schema.scopeItems.id });
  await revalidateProject(d.propertyId, d.projectId);
  return { ok: true, id: row.id };
}

export async function updateScopeItem(input: {
  id: number;
  propertyId: number;
  projectId: number;
  item?: string;
  materialQuality?: string | null;
  quantity?: string | null;
  unitPrice?: string | null;
  costCodeId?: number | null;
  startDate?: string | null;
  endDate?: string | null;
  specs?: { cols: string[]; rows: string[][] } | null;
}): Promise<ActionResult> {
  const set: Partial<typeof schema.scopeItems.$inferInsert> = {};

  if (input.item !== undefined) {
    const trimmed = input.item.trim();
    if (!trimmed) return { ok: false, error: "Item is required" };
    set.item = trimmed;
  }
  if (input.materialQuality !== undefined) {
    set.materialQuality = input.materialQuality?.trim() || null;
  }
  if (input.quantity !== undefined) {
    const trimmed = input.quantity?.trim() || null;
    if (trimmed !== null && Number.isNaN(Number(trimmed))) {
      return { ok: false, error: "Enter a valid units value" };
    }
    set.quantity = trimmed;
  }
  if (input.unitPrice !== undefined) {
    const trimmed = input.unitPrice?.trim() || null;
    if (trimmed !== null && Number.isNaN(Number(trimmed))) {
      return { ok: false, error: "Enter a valid unit cost" };
    }
    set.unitPrice = trimmed;
  }
  if (input.costCodeId !== undefined) {
    set.costCodeId = input.costCodeId;
  }
  if (input.startDate !== undefined) {
    set.startDate = input.startDate?.trim() || null;
  }
  if (input.endDate !== undefined) {
    set.endDate = input.endDate?.trim() || null;
  }
  if (input.specs !== undefined) {
    const parsed = input.specs === null ? null : specsSchema.safeParse(input.specs);
    if (parsed && !parsed.success) return { ok: false, error: "Invalid specification grid" };
    set.specs = parsed ? parsed.data : null;
  }

  if (Object.keys(set).length === 0) return { ok: true };

  // The row decides which project it is in, not the caller. Checking the lock
  // against input.projectId while writing by id alone meant an edit to a locked
  // project's line went through by naming an unlocked project.
  const owner = await scopeItemProjectId(input.id);
  if (owner == null) return { ok: false, error: "Scope item not found" };

  const locked = await checkScopeEditable(owner, Object.keys(set));
  if (locked) return { ok: false, error: locked };

  await db()
    .update(schema.scopeItems)
    .set(set)
    .where(and(eq(schema.scopeItems.id, input.id), eq(schema.scopeItems.projectId, owner)));
  await revalidateProject(input.propertyId, input.projectId);
  return { ok: true };
}

export async function deleteScopeItem(input: {
  id: number;
  propertyId: number;
  projectId: number;
}): Promise<ActionResult> {
  const owner = await scopeItemProjectId(input.id);
  if (owner == null) return { ok: false, error: "Scope item not found" };
  const locked = await checkScopeStructureEditable(owner);
  if (locked) return { ok: false, error: locked };

  await db()
    .update(schema.scopeItems)
    .set({ archivedAt: new Date() })
    .where(eq(schema.scopeItems.id, input.id));
  await revalidateProject(input.propertyId, input.projectId);
  return { ok: true };
}

/** Reverses deleteScopeItem — used by the delete toast's Undo action. */
export async function restoreScopeItem(input: {
  id: number;
  propertyId: number;
  projectId: number;
}): Promise<ActionResult> {
  const owner = await scopeItemProjectId(input.id);
  if (owner == null) return { ok: false, error: "Scope item not found" };
  const locked = await checkScopeStructureEditable(owner);
  if (locked) return { ok: false, error: locked };

  await db()
    .update(schema.scopeItems)
    .set({ archivedAt: null })
    .where(eq(schema.scopeItems.id, input.id));
  await revalidateProject(input.propertyId, input.projectId);
  return { ok: true };
}



"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import type { ActionResult } from "@/lib/action-result";
import { DIVISION_KEYS } from "@/lib/divisions";

// ---------------------------------------------------------------------------
// Chart of accounts
// ---------------------------------------------------------------------------

function revalidateCoa(chartId?: number) {
  revalidatePath("/settings/chart-of-accounts");
  if (chartId != null) revalidatePath(`/settings/chart-of-accounts/${chartId}`);
}

const categorySchema = z.object({
  chartId: z.coerce.number().int().positive(),
  code: z.string().trim().min(1, "Code is required"),
  name: z.string().trim().min(1, "Name is required"),
});

export async function createCategory(formData: FormData): Promise<ActionResult> {
  const parsed = categorySchema.safeParse({
    chartId: formData.get("chartId"),
    code: formData.get("code"),
    name: formData.get("name"),
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { chartId } = parsed.data;

  const existing = await db().query.costCategories.findFirst({
    where: and(
      eq(schema.costCategories.chartId, chartId),
      eq(schema.costCategories.code, parsed.data.code),
    ),
  });
  if (existing) return { ok: false, error: `Category code ${parsed.data.code} already exists in this chart` };

  const [{ maxOrder }] = await db()
    .select({ maxOrder: sql<number>`coalesce(max(${schema.costCategories.sortOrder}), 0)::int` })
    .from(schema.costCategories)
    .where(eq(schema.costCategories.chartId, chartId));

  await db()
    .insert(schema.costCategories)
    .values({ chartId, code: parsed.data.code, name: parsed.data.name, sortOrder: maxOrder + 1 });
  revalidateCoa(chartId);
  return { ok: true };
}

export async function renameCategory(id: number, name: string): Promise<ActionResult> {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Name is required" };
  const [row] = await db()
    .update(schema.costCategories)
    .set({ name: trimmed })
    .where(eq(schema.costCategories.id, id))
    .returning({ chartId: schema.costCategories.chartId });
  revalidateCoa(row?.chartId);
  return { ok: true };
}

export async function setCategoryDivision(
  id: number,
  division: string | null,
): Promise<ActionResult> {
  const value = division === "" ? null : division;
  if (value !== null && !DIVISION_KEYS.includes(value as (typeof DIVISION_KEYS)[number])) {
    return { ok: false, error: "Invalid division" };
  }
  const [row] = await db()
    .update(schema.costCategories)
    .set({ division: value })
    .where(eq(schema.costCategories.id, id))
    .returning({ chartId: schema.costCategories.chartId });
  revalidateCoa(row?.chartId);
  return { ok: true };
}

const costCodeSchema = z.object({
  categoryId: z.coerce.number().int().positive(),
  code: z.string().trim().min(1, "Code is required"),
  name: z.string().trim().min(1, "Name is required"),
  isInterior: z.coerce.boolean().optional(),
});

export async function createCostCode(formData: FormData): Promise<ActionResult> {
  const parsed = costCodeSchema.safeParse({
    categoryId: formData.get("categoryId"),
    code: formData.get("code"),
    name: formData.get("name"),
    isInterior: formData.get("isInterior") === "on" || formData.get("isInterior") === "true",
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  // The code inherits its chart from the chosen category.
  const category = await db().query.costCategories.findFirst({
    where: eq(schema.costCategories.id, parsed.data.categoryId),
  });
  if (!category) return { ok: false, error: "Category not found" };
  const chartId = category.chartId;

  const existing = await db().query.costCodes.findFirst({
    where: and(eq(schema.costCodes.chartId, chartId), eq(schema.costCodes.code, parsed.data.code)),
  });
  if (existing) return { ok: false, error: `Cost code ${parsed.data.code} already exists in this chart` };

  await db().insert(schema.costCodes).values({
    chartId,
    categoryId: parsed.data.categoryId,
    code: parsed.data.code,
    name: parsed.data.name,
    isInterior: parsed.data.isInterior ?? false,
  });
  revalidateCoa(chartId);
  return { ok: true };
}

export async function updateCostCode(input: {
  id: number;
  name?: string;
  active?: boolean;
  isInterior?: boolean;
}): Promise<ActionResult> {
  const set: Partial<typeof schema.costCodes.$inferInsert> = {};
  if (input.name !== undefined) {
    const trimmed = input.name.trim();
    if (!trimmed) return { ok: false, error: "Name is required" };
    set.name = trimmed;
  }
  if (input.active !== undefined) set.active = input.active;
  if (input.isInterior !== undefined) set.isInterior = input.isInterior;
  if (Object.keys(set).length === 0) return { ok: true };
  const [row] = await db()
    .update(schema.costCodes)
    .set(set)
    .where(eq(schema.costCodes.id, input.id))
    .returning({ chartId: schema.costCodes.chartId });
  revalidateCoa(row?.chartId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Users (profiles). Auth isn't wired yet, so these are roster entries; the id
// will line up with a Supabase auth user once sign-in is added.
// ---------------------------------------------------------------------------

const ROLES = ["admin", "cm", "site", "viewer"] as const;

function revalidateUsers() {
  revalidatePath("/settings/users");
}

const userSchema = z.object({
  email: z.string().trim().email("Enter a valid email"),
  fullName: z.string().trim().optional(),
  role: z.enum(ROLES),
});

export async function createProfile(formData: FormData): Promise<ActionResult> {
  const parsed = userSchema.safeParse({
    email: formData.get("email"),
    fullName: formData.get("fullName") || undefined,
    role: formData.get("role"),
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const existing = await db().query.profiles.findFirst({
    where: and(
      eq(schema.profiles.email, parsed.data.email.toLowerCase()),
      isNull(schema.profiles.archivedAt),
    ),
  });
  if (existing) return { ok: false, error: `${parsed.data.email} is already a user` };

  await db().insert(schema.profiles).values({
    id: crypto.randomUUID(),
    email: parsed.data.email.toLowerCase(),
    fullName: parsed.data.fullName,
    role: parsed.data.role,
  });
  revalidateUsers();
  return { ok: true };
}

const updateProfileSchema = z.object({
  id: z.string().trim().min(1),
  email: z.string().trim().email("Enter a valid email"),
  fullName: z.string().trim().optional(),
  role: z.enum(ROLES),
});

export async function updateProfile(formData: FormData): Promise<ActionResult> {
  const parsed = updateProfileSchema.safeParse({
    id: formData.get("id"),
    email: formData.get("email"),
    fullName: formData.get("fullName") || undefined,
    role: formData.get("role"),
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const normalizedEmail = parsed.data.email.toLowerCase();

  const existing = await db().query.profiles.findFirst({
    where: and(eq(schema.profiles.email, normalizedEmail), isNull(schema.profiles.archivedAt)),
  });
  if (existing && existing.id !== parsed.data.id) {
    return { ok: false, error: `${normalizedEmail} is already a user` };
  }

  await db()
    .update(schema.profiles)
    .set({
      email: normalizedEmail,
      fullName: parsed.data.fullName ?? null,
      role: parsed.data.role,
    })
    .where(eq(schema.profiles.id, parsed.data.id));
  revalidateUsers();
  return { ok: true };
}

/**
 * Soft-delete — removes this person from the active roster/role list but
 * keeps the profile row so it isn't orphaned by FKs (stage events, uploads).
 * Note: this does not revoke their Supabase Auth sign-in; it only clears
 * their app role. Restorable via restoreProfile.
 */
export async function deleteProfile(id: string): Promise<ActionResult> {
  await db().update(schema.profiles).set({ archivedAt: new Date() }).where(eq(schema.profiles.id, id));
  revalidateUsers();
  return { ok: true };
}

export async function restoreProfile(id: string): Promise<ActionResult> {
  await db().update(schema.profiles).set({ archivedAt: null }).where(eq(schema.profiles.id, id));
  revalidateUsers();
  return { ok: true };
}

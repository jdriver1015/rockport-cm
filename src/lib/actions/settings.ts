"use server";

import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";

// ---------------------------------------------------------------------------
// Chart of accounts
// ---------------------------------------------------------------------------

function revalidateCoa() {
  revalidatePath("/settings/chart-of-accounts");
}

const categorySchema = z.object({
  code: z.string().trim().min(1, "Code is required"),
  name: z.string().trim().min(1, "Name is required"),
});

export async function createCategory(formData: FormData) {
  const parsed = categorySchema.parse({
    code: formData.get("code"),
    name: formData.get("name"),
  });
  const existing = await db().query.costCategories.findFirst({
    where: eq(schema.costCategories.code, parsed.code),
  });
  if (existing) throw new Error(`Category code ${parsed.code} already exists`);

  const [{ maxOrder }] = await db()
    .select({ maxOrder: sql<number>`coalesce(max(${schema.costCategories.sortOrder}), 0)::int` })
    .from(schema.costCategories);

  await db()
    .insert(schema.costCategories)
    .values({ code: parsed.code, name: parsed.name, sortOrder: maxOrder + 1 });
  revalidateCoa();
}

export async function renameCategory(id: number, name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Name is required");
  await db()
    .update(schema.costCategories)
    .set({ name: trimmed })
    .where(eq(schema.costCategories.id, id));
  revalidateCoa();
}

const costCodeSchema = z.object({
  categoryId: z.coerce.number().int().positive(),
  code: z.string().trim().min(1, "Code is required"),
  name: z.string().trim().min(1, "Name is required"),
  isInterior: z.coerce.boolean().optional(),
});

export async function createCostCode(formData: FormData) {
  const parsed = costCodeSchema.parse({
    categoryId: formData.get("categoryId"),
    code: formData.get("code"),
    name: formData.get("name"),
    isInterior: formData.get("isInterior") === "on" || formData.get("isInterior") === "true",
  });
  const existing = await db().query.costCodes.findFirst({
    where: eq(schema.costCodes.code, parsed.code),
  });
  if (existing) throw new Error(`Cost code ${parsed.code} already exists`);

  await db().insert(schema.costCodes).values({
    categoryId: parsed.categoryId,
    code: parsed.code,
    name: parsed.name,
    isInterior: parsed.isInterior ?? false,
  });
  revalidateCoa();
}

export async function updateCostCode(input: {
  id: number;
  name?: string;
  active?: boolean;
  isInterior?: boolean;
}) {
  const set: Partial<typeof schema.costCodes.$inferInsert> = {};
  if (input.name !== undefined) {
    const trimmed = input.name.trim();
    if (!trimmed) throw new Error("Name is required");
    set.name = trimmed;
  }
  if (input.active !== undefined) set.active = input.active;
  if (input.isInterior !== undefined) set.isInterior = input.isInterior;
  if (Object.keys(set).length === 0) return;
  await db().update(schema.costCodes).set(set).where(eq(schema.costCodes.id, input.id));
  revalidateCoa();
}

export async function deleteCostCode(id: number) {
  // Guard against deleting a code that's referenced anywhere
  const countWhere = async (
    table: typeof schema.budgetLines | typeof schema.glTransactions | typeof schema.projects | typeof schema.mappingRules,
    col: unknown,
  ) => {
    const [{ count }] = await db()
      .select({ count: sql<number>`count(*)::int` })
      .from(table)
      .where(eq(col as never, id));
    return count;
  };

  const refs: [string, number][] = [
    ["budget lines", await countWhere(schema.budgetLines, schema.budgetLines.costCodeId)],
    ["GL transactions", await countWhere(schema.glTransactions, schema.glTransactions.costCodeId)],
    ["projects", await countWhere(schema.projects, schema.projects.costCodeId)],
    ["mapping rules", await countWhere(schema.mappingRules, schema.mappingRules.costCodeId)],
  ];
  const inUse = refs.find(([, n]) => n > 0);
  if (inUse) {
    throw new Error(`In use by ${inUse[1]} ${inUse[0]} — deactivate it instead of deleting`);
  }

  await db().delete(schema.costCodes).where(eq(schema.costCodes.id, id));
  revalidateCoa();
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

export async function createProfile(formData: FormData) {
  const parsed = userSchema.parse({
    email: formData.get("email"),
    fullName: formData.get("fullName") || undefined,
    role: formData.get("role"),
  });
  const existing = await db().query.profiles.findFirst({
    where: eq(schema.profiles.email, parsed.email.toLowerCase()),
  });
  if (existing) throw new Error(`${parsed.email} is already a user`);

  await db().insert(schema.profiles).values({
    id: crypto.randomUUID(),
    email: parsed.email.toLowerCase(),
    fullName: parsed.fullName,
    role: parsed.role,
  });
  revalidateUsers();
}

export async function updateProfileRole(id: string, role: (typeof ROLES)[number]) {
  if (!ROLES.includes(role)) throw new Error("Invalid role");
  await db().update(schema.profiles).set({ role }).where(eq(schema.profiles.id, id));
  revalidateUsers();
}

export async function deleteProfile(id: string) {
  await db().delete(schema.profiles).where(eq(schema.profiles.id, id));
  revalidateUsers();
}

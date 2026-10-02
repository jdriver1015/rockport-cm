"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import type { ActionResult } from "@/lib/action-result";
import { DIVISION_KEYS } from "@/lib/divisions";
import { invalidateInteriorBudgetForChart } from "@/lib/interior-budget";
import { requireUser } from "@/lib/auth";
import { AUTH_ROLES, ROLE_LABELS, canAdminProperty, type AuthRole } from "@/lib/auth-rules";
import { ACCOUNT_FROM_ADDRESS, sendEmail } from "@/lib/email";
import {
  accountEmailHtml,
  accountEmailSubject,
  accountEmailText,
  type AccountEmailKind,
} from "@/lib/account-email";
import { issueSignInLink, setSignInBlocked, syncSignInEmail } from "@/lib/user-access";

// ---------------------------------------------------------------------------
// Chart of accounts
// ---------------------------------------------------------------------------

async function revalidateCoa(chartId?: number) {
  revalidatePath("/settings/chart-of-accounts");
  if (chartId == null) return;
  revalidatePath(`/settings/chart-of-accounts/${chartId}`);
  // A category move or a cost code's isInterior flag can change the interior
  // budget for every property bound to this chart, not just one.
  await invalidateInteriorBudgetForChart(chartId);
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
  await revalidateCoa(chartId);
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
  await revalidateCoa(row?.chartId);
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
  await revalidateCoa(row?.chartId);
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
  await revalidateCoa(chartId);
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
  await revalidateCoa(row?.chartId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Users (profiles) and their sign-in accounts.
//
// Access is by invitation: adding a person creates their roster row and a
// sign-in account with the same id, and emails them a one-time link to set
// their own password (see user-access.ts). Admin only — these decide who can
// see the portfolio at all.
// ---------------------------------------------------------------------------

const ROLES = AUTH_ROLES;

function revalidateUsers() {
  revalidatePath("/settings/users");
}

/** The signed-in admin, or the refusal to hand back. */
async function requireAdmin() {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  if (!canAdminProperty(auth.profile.role)) {
    return { ok: false as const, error: "Only an admin can manage users" };
  }
  return auth;
}

/**
 * What happened to the email. When it could not be delivered — mail not set
 * up, or a local run whose links nobody else could open — the admin gets the
 * link to pass on themselves instead, so an invite never just fails silently.
 */
export type InviteDelivery =
  | { delivered: true; kind: AccountEmailKind }
  | { delivered: false; kind: AccountEmailKind | null; reason: string; link: string | null };

async function sendSignInEmail(
  person: { id: string; email: string; fullName: string | null; role: AuthRole },
  sender: { id: string; email: string },
): Promise<InviteDelivery> {
  const issued = await issueSignInLink(person);
  if (!issued.ok) return { delivered: false, kind: null, reason: issued.error, link: null };

  const senderRow = await db().query.profiles.findFirst({
    where: eq(schema.profiles.id, sender.id),
    columns: { fullName: true },
  });
  const mail = {
    kind: issued.kind,
    fullName: person.fullName,
    email: person.email,
    roleLabel: ROLE_LABELS[person.role],
    link: issued.link,
    senderName: senderRow?.fullName ?? null,
  };
  const sent = await sendEmail({
    from: ACCOUNT_FROM_ADDRESS,
    to: person.email,
    // Questions about an invite go to the person who sent it.
    replyTo: sender.email,
    subject: accountEmailSubject(mail),
    html: accountEmailHtml(mail),
    text: accountEmailText(mail),
  });
  if (sent.ok) return { delivered: true, kind: issued.kind };
  return { delivered: false, kind: issued.kind, reason: sent.error, link: issued.link };
}

const userSchema = z.object({
  email: z.string().trim().email("Enter a valid email"),
  fullName: z.string().trim().optional(),
  role: z.enum(ROLES),
});

/**
 * Add a person and invite them.
 *
 * The roster row is kept even when the invite cannot be created or sent — the
 * person exists and has a role either way — and the result says what to do
 * next, so a missing mail key never loses the person that was just typed in.
 */
export async function inviteUser(
  formData: FormData,
): Promise<ActionResult<{ delivery: InviteDelivery }>> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  const parsed = userSchema.safeParse({
    email: formData.get("email"),
    fullName: formData.get("fullName") || undefined,
    role: formData.get("role"),
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const email = parsed.data.email.toLowerCase();

  const existing = await db().query.profiles.findFirst({
    where: eq(schema.profiles.email, email),
    // Postgres sorts nulls first on DESC, so an active row wins over an archived one.
    orderBy: (p, { desc }) => [desc(p.archivedAt)],
  });
  if (existing && !existing.archivedAt) return { ok: false, error: `${email} is already a user` };
  // Their sign-in account still exists, blocked; a second roster row would
  // leave the two pointing at different ids.
  if (existing) {
    return { ok: false, error: `${email} was removed earlier — restore them from Archived instead` };
  }

  const [person] = await db()
    .insert(schema.profiles)
    .values({ id: crypto.randomUUID(), email, fullName: parsed.data.fullName, role: parsed.data.role })
    .returning();
  revalidateUsers();

  const delivery = await sendSignInEmail(
    { id: person.id, email, fullName: person.fullName, role: parsed.data.role },
    auth.profile,
  );
  return { ok: true, delivery };
}

/**
 * Send someone a fresh link: the welcome again if they have never signed in,
 * a password reset if they have. The same link either way — it signs them in
 * and opens "set your password".
 */
export async function sendSignInLink(id: string): Promise<ActionResult<{ delivery: InviteDelivery }>> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  const person = await db().query.profiles.findFirst({
    where: and(eq(schema.profiles.id, id), isNull(schema.profiles.archivedAt)),
  });
  if (!person) return { ok: false, error: "User not found" };

  const delivery = await sendSignInEmail(
    { id: person.id, email: person.email, fullName: person.fullName, role: person.role as AuthRole },
    auth.profile,
  );
  revalidateUsers();
  return { ok: true, delivery };
}

const updateProfileSchema = z.object({
  id: z.string().trim().min(1),
  email: z.string().trim().email("Enter a valid email"),
  fullName: z.string().trim().optional(),
  role: z.enum(ROLES),
});

export async function updateProfile(formData: FormData): Promise<ActionResult> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

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
  // The last way to lock everyone out of user management is an admin taking
  // their own admin role away.
  if (parsed.data.id === auth.profile.id && parsed.data.role !== "admin") {
    return { ok: false, error: "You can't remove your own admin role" };
  }

  // The sign-in email follows the roster's, or the person would be invited at
  // one address and have to sign in with another.
  const before = await db().query.profiles.findFirst({
    where: eq(schema.profiles.id, parsed.data.id),
    columns: { email: true },
  });
  if (before && before.email !== normalizedEmail) {
    const err = await syncSignInEmail(parsed.data.id, normalizedEmail);
    if (err) return { ok: false, error: `Couldn't change their sign-in email: ${err}` };
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
 * Soft-delete — removes this person from the active roster and takes their
 * access away. The profile row stays so nothing that names them is orphaned
 * (stage events, uploads); their sign-in is blocked, and the app refuses an
 * archived roster row even on a session that is already open. Restorable via
 * restoreProfile.
 */
export async function deleteProfile(id: string): Promise<ActionResult> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;
  if (id === auth.profile.id) return { ok: false, error: "You can't remove yourself" };

  const err = await setSignInBlocked(id, true);
  if (err) return { ok: false, error: `Couldn't block their sign-in: ${err}` };
  await db().update(schema.profiles).set({ archivedAt: new Date() }).where(eq(schema.profiles.id, id));
  revalidateUsers();
  return { ok: true };
}

export async function restoreProfile(id: string): Promise<ActionResult> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  // Restoring next to an active row with the same email would break the
  // one-active-row-per-email index rather than say why.
  const row = await db().query.profiles.findFirst({
    where: eq(schema.profiles.id, id),
    columns: { email: true },
  });
  if (!row) return { ok: false, error: "User not found" };
  const clash = await db().query.profiles.findFirst({
    where: and(eq(schema.profiles.email, row.email), isNull(schema.profiles.archivedAt)),
    columns: { id: true },
  });
  if (clash) return { ok: false, error: `${row.email} is already an active user` };

  const err = await setSignInBlocked(id, false);
  if (err) return { ok: false, error: `Couldn't unblock their sign-in: ${err}` };
  await db().update(schema.profiles).set({ archivedAt: null }).where(eq(schema.profiles.id, id));
  revalidateUsers();
  return { ok: true };
}

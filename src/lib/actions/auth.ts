"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { ensureProfile } from "@/lib/ensure-profile";
import type { ActionResult } from "@/lib/action-result";

function siteUrl() {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}

const credsSchema = z.object({
  email: z.string().trim().email("Enter a valid email"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

/**
 * Expected errors (bad credentials, validation) are returned as values, not
 * thrown — this Next.js version bubbles thrown Server Action errors straight
 * to the nearest error boundary instead of rejecting the caller's promise, so
 * a client-side try/catch never sees them.
 */
export async function signIn(formData: FormData): Promise<ActionResult> {
  const parsed = credsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { ok: false, error: error.message };
  if (!data.user) return { ok: false, error: "Sign in failed" };

  await ensureProfile(data.user.id, data.user.email ?? parsed.data.email, data.user.user_metadata?.full_name);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function signUp(formData: FormData): Promise<ActionResult<{ needsConfirmation: boolean }>> {
  const parsed = credsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const fullName = (formData.get("fullName") as string | null)?.trim() || undefined;

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: fullName ? { full_name: fullName } : undefined,
      emailRedirectTo: `${siteUrl()}/auth/callback`,
    },
  });
  if (error) return { ok: false, error: error.message };
  if (!data.user) return { ok: false, error: "Sign up failed" };

  if (data.session) {
    await ensureProfile(data.user.id, parsed.data.email, fullName);
    revalidatePath("/", "layout");
    return { ok: true, needsConfirmation: false };
  }

  return { ok: true, needsConfirmation: true };
}

const emailSchema = z.object({ email: z.string().trim().email("Enter a valid email") });

export async function requestPasswordReset(formData: FormData): Promise<ActionResult> {
  const parsed = emailSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const next = encodeURIComponent("/auth/reset-password");
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${siteUrl()}/auth/callback?next=${next}`,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

const newPasswordSchema = z.object({
  password: z.string().min(6, "Password must be at least 6 characters"),
});

/** Requires an active (recovery) session — see /auth/reset-password. */
export async function updatePassword(formData: FormData): Promise<ActionResult> {
  const parsed = newPasswordSchema.safeParse({ password: formData.get("password") });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Invoked from a plain `<form action={signOut}>` so redirect() works directly. */
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/sign-in");
}

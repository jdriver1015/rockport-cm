"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { ensureProfile } from "@/lib/ensure-profile";

function siteUrl() {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}

const credsSchema = z.object({
  email: z.string().trim().email("Enter a valid email"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

/**
 * Called imperatively from a client form (not a plain `<form action>`), so it
 * returns a result instead of calling redirect() — redirect() throws a signal
 * that a surrounding client-side try/catch would otherwise swallow.
 */
export async function signIn(formData: FormData): Promise<{ ok: true }> {
  const parsed = credsSchema.parse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed);
  if (error) throw new Error(error.message);
  if (!data.user) throw new Error("Sign in failed");

  await ensureProfile(data.user.id, data.user.email ?? parsed.email, data.user.user_metadata?.full_name);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function signUp(
  formData: FormData,
): Promise<{ needsConfirmation: boolean }> {
  const parsed = credsSchema.parse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  const fullName = (formData.get("fullName") as string | null)?.trim() || undefined;

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.email,
    password: parsed.password,
    options: {
      data: fullName ? { full_name: fullName } : undefined,
      emailRedirectTo: `${siteUrl()}/auth/callback`,
    },
  });
  if (error) throw new Error(error.message);
  if (!data.user) throw new Error("Sign up failed");

  if (data.session) {
    await ensureProfile(data.user.id, parsed.email, fullName);
    revalidatePath("/", "layout");
    return { needsConfirmation: false };
  }

  return { needsConfirmation: true };
}

const emailSchema = z.object({ email: z.string().trim().email("Enter a valid email") });

export async function sendMagicLink(formData: FormData): Promise<{ ok: true }> {
  const parsed = emailSchema.parse({ email: formData.get("email") });
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.email,
    options: { emailRedirectTo: `${siteUrl()}/auth/callback` },
  });
  if (error) throw new Error(error.message);
  return { ok: true };
}

/** Invoked from a plain `<form action={signOut}>` so redirect() works directly. */
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/sign-in");
}

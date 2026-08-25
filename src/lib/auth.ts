/**
 * Auth helpers for Server Actions and route handlers.
 *
 * Every action that touches the DB should call `requireUser()` as its first
 * line and short-circuit on `{ ok: false, error }`. The profile returned
 * carries the user's role and id, ready for downstream `canWriteProperty(role)`
 * style checks.
 *
 * Why this isn't enforced at the DB layer: the app uses the Supabase
 * service-role client (createAdminClient) to bypass RLS for the storage
 * admin operations. That made auth a layer-zero concern that never landed.
 * Until that changes, every action that handles user-supplied ids needs a
 * call to `requireUser()` to know who's holding the cookie.
 *
 * Today the role gate is loose — a `cm` can read and write every property in
 * the portfolio. The pure rules in `src/lib/auth-rules.ts` are the single
 * place to tighten that. The matrix is intentionally written so a future
 * per-property membership table can swap in without touching action call sites.
 */
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { createClient } from "@/lib/supabase/server";
import { ensureProfile } from "@/lib/ensure-profile";
import type { AuthRole } from "@/lib/auth-rules";

export type LoadedProfile = {
  id: string;
  email: string;
  role: AuthRole;
};

export class AuthError extends Error {
  constructor(public readonly code: "no_session" | "no_profile", message: string) {
    super(message);
    this.name = "AuthError";
  }
}

/**
 * Resolve the active session user to a `profiles` row, returning either the
 * loaded profile or an `ActionResult`-shaped error suitable for immediate
 * short-circuit.
 *
 * Two failure modes:
 *  1. No active session (visitor hit a server action directly) — `no_session`
 *  2. Session resolved but no `profiles` row — `no_profile` (rare; the
 *     fallback is the `ensureProfile()` helper which materializes a default
 *     viewer row for a brand-new user).
 */
export async function loadActiveProfile(): Promise<
  { ok: true; profile: LoadedProfile } | { ok: false; error: string; code: AuthError["code"] }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) return { ok: false, code: "no_session", error: "Not signed in" };

  const existing = await db().query.profiles.findFirst({
    where: eq(schema.profiles.id, user.id),
  });
  if (existing) {
    return {
      ok: true,
      profile: {
        id: existing.id,
        email: existing.email,
        role: existing.role as AuthRole,
      },
    };
  }

  // First-time login without a roster pre-provision. Materialize a default
  // viewer profile so the rest of the app has something to render. The
  // `ensureProfile` helper is responsible for adopting a pre-existing roster
  // entry by email.
  await ensureProfile(user.id, user.email, user.user_metadata?.full_name ?? null);

  const afterEnsure = await db().query.profiles.findFirst({
    where: eq(schema.profiles.id, user.id),
  });
  if (!afterEnsure) {
    return { ok: false, code: "no_profile", error: "Profile not set up" };
  }
  return {
    ok: true,
    profile: {
      id: afterEnsure.id,
      email: afterEnsure.email,
      role: afterEnsure.role as AuthRole,
    },
  };
}

/**
 * Convenience: every action's first line is `const profile = requireUser()`.
 * On failure the caller does `if (!profile.ok) return profile;` and the
 * inferred type narrows the rest of the function to `LoadedProfile`.
 *
 * Pattern (illustrative — do not literally copy):
 *   export async function someAction(...): Promise<ActionResult> {
 *     const profile = await requireUser();
 *     if (!profile.ok) return profile;
 *     // profile.profile is now the active user
 *   }
 *
 * Return shape: this deliberately returns a FOUR-ARMED union rather than
 * the simple two-arm `ActionResult` shape — collapsing it would lose the
 * `profile` field on success because `ActionResult`'s `T` defaults to `{}`,
 * and a `{ok:true}` and a `{ok:true, profile}` would be indistinguishable
 * on the ok field alone. See callers for how the narrowing works.
 */
export type RequireUserResult =
  | { ok: true; profile: LoadedProfile }
  | { ok: false; error: string };

export async function requireUser(): Promise<RequireUserResult> {
  const r = await loadActiveProfile();
  if (!r.ok) return { ok: false, error: r.error };
  return r;
}

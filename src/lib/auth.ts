/**
 * Auth helpers for Server Actions and route handlers.
 *
 * Every action that touches the DB should call `requireUser()` as its first
 * line and short-circuit on `{ ok: false, error }`. The profile returned
 * carries the user's role and id, ready for downstream `canWriteProperty(role)`
 * style checks.
 *
 * SANDBOX: sign-in has been removed; see src/lib/sandbox-user.ts.
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
import { SANDBOX_USER } from "@/lib/sandbox-user";
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
 * Sandbox build: there is no session to resolve. Everyone is the fixed
 * sandbox admin, so this always succeeds.
 */
export async function loadActiveProfile(): Promise<
  { ok: true; profile: LoadedProfile } | { ok: false; error: string; code: AuthError["code"] }
> {
  return {
    ok: true,
    profile: { id: SANDBOX_USER.id, email: SANDBOX_USER.email, role: SANDBOX_USER.role },
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

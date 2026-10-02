import { createAdminClient } from "@/lib/supabase/admin";
import { appOrigin } from "@/lib/email";
import type { AccountEmailKind } from "@/lib/account-email";

// ---------------------------------------------------------------------------
// Sign-in accounts for roster entries.
//
// A person on the roster (profiles) signs in with a Supabase auth user. The auth
// user is created with the roster row's own id, so the link between the two is
// the id and nothing has to be re-keyed afterwards — re-keying means repointing
// every table that names the person (managers, uploads, activity logs), which
// is how the old email-adoption path could fail.
//
// Server-only: everything here uses the service-role client. Callers check that
// the person acting is an admin first.
// ---------------------------------------------------------------------------

export type AuthStatus = {
  /** When their latest invite or password link was issued, if ever. */
  linkSentAt: string | null;
  lastSignInAt: string | null;
  /** Sign-in blocked — set when the person is removed from the roster. */
  blocked: boolean;
};

function adminOrNull() {
  try {
    return createAdminClient();
  } catch {
    return null;
  }
}

/**
 * Every sign-in account's state, keyed by id.
 *
 * Empty when the service-role key is not configured — the roster still renders,
 * every person just reads as not invited.
 */
export async function readAuthStatuses(): Promise<Map<string, AuthStatus>> {
  const out = new Map<string, AuthStatus>();
  const admin = adminOrNull();
  if (!admin) return out;

  const now = Date.now();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) break;
    for (const u of data.users) {
      out.set(u.id, {
        linkSentAt: u.recovery_sent_at ?? u.invited_at ?? null,
        lastSignInAt: u.last_sign_in_at ?? null,
        blocked: !!u.banned_until && new Date(u.banned_until).getTime() > now,
      });
    }
    if (data.users.length < 1000) break;
  }
  return out;
}

export type SignInLink =
  | { ok: true; link: string; kind: AccountEmailKind }
  | { ok: false; error: string };

/**
 * Make sure this roster entry can sign in, and mint a one-time link that signs
 * them in and opens "set your password".
 *
 * Creates the sign-in account on first use (with the roster id), and keeps its
 * email in step with the roster's. The link is Supabase's own recovery token,
 * verified by /auth/confirm — no password is ever generated or sent. Someone who
 * has never signed in gets the welcome; someone who has gets a reset.
 */
export async function issueSignInLink(profile: {
  id: string;
  email: string;
  fullName: string | null;
}): Promise<SignInLink> {
  const admin = adminOrNull();
  if (!admin) {
    return { ok: false, error: "Sign-in accounts can't be created: SUPABASE_SERVICE_ROLE_KEY is not set" };
  }

  const found = await admin.auth.admin.getUserById(profile.id);
  if (found.error && found.error.status !== 404) return { ok: false, error: found.error.message };
  const existing = found.data.user;

  if (!existing) {
    const created = await admin.auth.admin.createUser({
      id: profile.id,
      email: profile.email,
      // The admin typed this address, and only its inbox receives the link, so
      // there is nothing left for a confirmation email to prove.
      email_confirm: true,
      user_metadata: profile.fullName ? { full_name: profile.fullName } : undefined,
    });
    if (created.error) {
      return {
        ok: false,
        error: /already|registered|exists/i.test(created.error.message)
          ? `${profile.email} already has a sign-in account from before invites. Ask them to use "Forgot password?" on the sign-in page — signing in links it to this person.`
          : created.error.message,
      };
    }
  } else if (existing.email?.toLowerCase() !== profile.email.toLowerCase()) {
    const updated = await admin.auth.admin.updateUserById(profile.id, {
      email: profile.email,
      email_confirm: true,
    });
    if (updated.error) return { ok: false, error: updated.error.message };
  }

  const generated = await admin.auth.admin.generateLink({ type: "recovery", email: profile.email });
  const tokenHash = generated.data.properties?.hashed_token;
  if (generated.error || !tokenHash) {
    return { ok: false, error: generated.error?.message ?? "Could not create a sign-in link" };
  }

  const kind: AccountEmailKind = existing?.last_sign_in_at ? "reset" : "invite";
  const url = new URL("/auth/confirm", appOrigin());
  url.searchParams.set("token_hash", tokenHash);
  url.searchParams.set("type", "recovery");
  url.searchParams.set("next", kind === "invite" ? "/auth/reset-password?welcome=1" : "/auth/reset-password");
  return { ok: true, link: url.toString(), kind };
}

/**
 * Block or unblock signing in, for removing and restoring a person.
 *
 * A ban stops new sign-ins and token refreshes at Supabase; the app's own check
 * (loadActiveProfile, the root layout) refuses an archived roster row
 * immediately, so the ban is the backstop for a session that is already open.
 * A person who was never invited has no account, which is not an error here.
 */
export async function setSignInBlocked(id: string, blocked: boolean): Promise<string | null> {
  const admin = adminOrNull();
  if (!admin) return null;
  const { error } = await admin.auth.admin.updateUserById(id, {
    ban_duration: blocked ? "876000h" : "none",
  });
  return error && error.status !== 404 ? error.message : null;
}

/** Keep the sign-in email in step when the roster email is edited. */
export async function syncSignInEmail(id: string, email: string): Promise<string | null> {
  const admin = adminOrNull();
  if (!admin) return null;
  const { error } = await admin.auth.admin.updateUserById(id, { email, email_confirm: true });
  return error && error.status !== 404 ? error.message : null;
}

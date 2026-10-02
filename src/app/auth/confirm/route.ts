import { NextRequest, NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { ensureProfile } from "@/lib/ensure-profile";

/**
 * Where an invite or password link lands.
 *
 * The link carries Supabase's hashed one-time token (minted by
 * issueSignInLink), not a session: verifying it here, on the server, is what
 * signs the person in and sets the cookie. The callback route next door
 * handles the PKCE `code` flow the "Forgot password?" email uses; this one is
 * the token-hash flow, which works in whatever browser the email is opened in.
 *
 * Only a person with an active roster row is let through — a link for someone
 * removed since it was sent signs nobody in.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = safeNext(searchParams.get("next"));

  if (!tokenHash || !type) {
    return NextResponse.redirect(`${origin}/sign-in?error=${encodeURIComponent("That link is incomplete")}`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error || !data.user) {
    return NextResponse.redirect(
      `${origin}/sign-in?error=${encodeURIComponent(
        "That link has expired or was already used. Ask an admin to send a new one.",
      )}`,
    );
  }

  const profile = await ensureProfile(data.user.id, data.user.email ?? "", data.user.user_metadata?.full_name);
  if (!profile) {
    await supabase.auth.signOut();
    return NextResponse.redirect(
      `${origin}/sign-in?error=${encodeURIComponent("This account doesn't have access to Rockport.")}`,
    );
  }

  return NextResponse.redirect(`${origin}${next}`);
}

/** A same-site path only — `next` comes from the URL, so never another host. */
function safeNext(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  return next;
}

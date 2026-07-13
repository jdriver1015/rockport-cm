import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ensureProfile } from "@/lib/ensure-profile";

/**
 * Handles the redirect from a sign-up email-confirmation link.
 *
 * On failure (expired/used/denied token), Supabase's verify endpoint puts the
 * error in a URL *hash fragment*, not a query param — hash fragments never
 * reach the server, so there's nothing to read here in that case. We can only
 * report a generic failure; the real reason is visible client-side, so
 * sign-in also checks location.hash for it (see SignInForm).
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data.user) {
      await ensureProfile(data.user.id, data.user.email ?? "", data.user.user_metadata?.full_name);
      return NextResponse.redirect(`${origin}${next}`);
    }
    return NextResponse.redirect(`${origin}/sign-in?error=${encodeURIComponent(error?.message ?? "auth")}`);
  }

  return NextResponse.redirect(`${origin}/sign-in?error=auth`);
}

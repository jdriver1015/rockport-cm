import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Paths served without a signed-in user.
 *
 * "/bid" is the vendor portal, and it is the only entry here that shows real
 * data: a contractor prices a scope at /bid/<token> with no account. The token
 * in the URL is the whole authorisation, so everything behind it is keyed by
 * that token and never by an id taken from the request — see src/lib/bid-portal.ts.
 *
 * Adding a prefix here makes every route beneath it world-readable. Nothing
 * should join this list without the same treatment.
 *
 * Note the trailing slash on "/bid/". These are matched with startsWith, so a
 * bare "/bid" would also match a future "/bids" page and make it public without
 * anyone meaning to.
 */
const PUBLIC_PREFIXES = ["/sign-in", "/sign-up", "/forgot-password", "/auth", "/bid/"];

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Must call getUser() (not getSession()) — it revalidates the token against
  // Supabase rather than trusting the cookie, which is what actually refreshes it.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublic = PUBLIC_PREFIXES.some((p) => request.nextUrl.pathname.startsWith(p));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  if (user && (request.nextUrl.pathname === "/sign-in" || request.nextUrl.pathname === "/sign-up")) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

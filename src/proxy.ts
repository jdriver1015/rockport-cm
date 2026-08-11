import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Exclude /api: every route handler already self-checks auth via
  // `supabase.auth.getUser()`, and running proxy on API routes means Next.js
  // buffers the whole request body (capped at 10MB by default, see
  // proxyClientMaxBodySize) to let both proxy and the handler read it — which
  // breaks larger multipart file uploads (e.g. rent-roll spreadsheets) with an
  // opaque "Failed to fetch" instead of a normal response.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};

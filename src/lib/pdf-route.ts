import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * The auth check every PDF route handler needs and nothing else — a route
 * handler returns a Response, not the ActionResult shape `requireUser()` in
 * `@/lib/auth` is built for, and none of these routes need a profile, only
 * proof someone is signed in.
 */
export async function requireSignedInApiUser(): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
  }
  return { ok: true };
}

/** A rendered PDF buffer as an inline, never-cached response. */
export function pdfResponse(buffer: Buffer, filename: string): NextResponse {
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      // Every caller of this helper is a contract or preview PDF, and each one
      // is either a draft that changes on every render or a document that must
      // not be served stale from a cache that predates a signature.
      "Cache-Control": "no-store",
    },
  });
}

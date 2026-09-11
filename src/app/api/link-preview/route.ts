import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * A thumbnail for a product spec link — the og:image (or twitter:image) a
 * vendor or manufacturer page already publishes for itself, so a spec row
 * with a link reads as a product, not a URL.
 *
 * Fetches server-side because the target page's CORS headers have no reason
 * to allow this app's origin, and because the alternative — an <img> pointed
 * straight at whatever URL someone pastes — would leak this app's presence
 * (referrer, cookies on redirect) to it.
 */

const MAX_BYTES = 300_000;
const TIMEOUT_MS = 5000;

/** Blocks the obvious internal-network targets. Not a substitute for a real
 *  egress policy — this is a staff-only internal tool, not a public one — but
 *  cheap enough that a pasted "http://localhost:5432" or "http://169.254.169.254/"
 *  doesn't silently get fetched by the server. */
function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h === "0.0.0.0") return true;
  if (h === "::1") return true;
  const parts = h.split(".");
  if (parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p))) {
    const [a, b] = parts.map(Number);
    if (a === 127) return true; // loopback
    if (a === 10) return true; // private
    if (a === 169 && b === 254) return true; // link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
  }
  return false;
}

function resolveMetaContent(html: string, matchers: RegExp[]): string | null {
  for (const re of matchers) {
    const m = html.match(re);
    if (m?.[1]) return m[1];
  }
  return null;
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const raw = req.nextUrl.searchParams.get("url");
  if (!raw) return NextResponse.json({ error: "Name a url with ?url=" }, { status: 400 });

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return NextResponse.json({ image: null, title: null });
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return NextResponse.json({ image: null, title: null });
  }
  if (isBlockedHost(target.hostname)) {
    return NextResponse.json({ image: null, title: null });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(target, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; WestcreekConstructionManager/1.0; +internal)",
        Accept: "text/html",
      },
    });
    if (!res.ok || !res.body) return NextResponse.json({ image: null, title: null });
    if (!(res.headers.get("content-type") ?? "").includes("html")) {
      return NextResponse.json({ image: null, title: null });
    }

    // Read just enough of the page to have a </head> — a product page's OG
    // tags live there, and the body can be megabytes of markup we don't need.
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let html = "";
    let bytes = 0;
    while (bytes < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      html += decoder.decode(value, { stream: true });
      if (/<\/head>/i.test(html)) break;
    }
    void reader.cancel().catch(() => {});

    const imageRaw = resolveMetaContent(html, [
      /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/i,
      /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i,
    ]);
    const title = resolveMetaContent(html, [
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
      /<title[^>]*>([^<]*)<\/title>/i,
    ]);

    let image: string | null = null;
    if (imageRaw) {
      try {
        const resolved = new URL(imageRaw, target);
        if (resolved.protocol === "http:" || resolved.protocol === "https:") image = resolved.toString();
      } catch {
        image = null;
      }
    }

    return NextResponse.json(
      { image, title: title?.trim().slice(0, 200) ?? null },
      { headers: { "Cache-Control": "private, max-age=86400" } },
    );
  } catch {
    return NextResponse.json({ image: null, title: null });
  } finally {
    clearTimeout(timer);
  }
}

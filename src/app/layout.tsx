import type { Metadata, Viewport } from "next";
import { Fraunces, Inter, Geist_Mono, IBM_Plex_Mono } from "next/font/google";
import Link from "next/link";
import { and, eq, isNull } from "drizzle-orm";
import { Toaster } from "@/components/ui/sonner";
import { TopNavLink } from "@/components/top-nav-link";
import { MobileNav } from "@/components/mobile-nav";
import { createClient } from "@/lib/supabase/server";
import { db, schema } from "@/db";
import { signOut } from "@/lib/actions/auth";
import "./globals.css";

// Display serif — wordmark, page titles, and card titles only. Fraunces over
// Newsreader: same editorial serif register, but drawn with cleaner, more
// contemporary letterforms — Newsreader's cedilla (as in "Façade") in
// particular sat oddly at heading weights.
const fraunces = Fraunces({
  variable: "--font-serif",
  subsets: ["latin"],
  weight: ["500", "600"],
});

// UI / body sans — everything else: navigation, KPIs, tables, body copy.
const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

/**
 * Declared rather than left to the framework default, because this app is used
 * on site: `viewportFit: "cover"` lets the layout reach under a notch, which is
 * what the safe-area padding in the mobile nav then accounts for. No
 * maximumScale — pinch-zoom on a photo of a defect is the point.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: "Rockport Construction Manager",
  description: "Portfolio construction tracking: budgets, ledger, unit turns",
};

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  cm: "Construction Manager",
  site: "Site staff",
  viewer: "Viewer",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Archived profiles fall back to plain email display — removed from the
  // roster means their role no longer applies, even if their Supabase Auth
  // session is still valid.
  const profile = user
    ? await db().query.profiles.findFirst({
        where: and(eq(schema.profiles.id, user.id), isNull(schema.profiles.archivedAt)),
      })
    : null;

  const navLinks = [
    { href: "/", label: "Portfolio" },
    { href: "/schedule", label: "Schedule" },
    { href: "/vendors", label: "Vendors" },
    { href: "/settings", label: "Settings" },
  ];
  const who = user
    ? `${profile?.fullName ?? user.email}${profile?.role ? ` · ${ROLE_LABEL[profile.role] ?? profile.role}` : ""}`
    : null;
  const signOutButton = (
    <form action={signOut}>
      <button
        type="submit"
        className="rounded-control bg-gold px-4 py-2 text-xs font-bold tracking-[0.03em] text-navy transition-colors hover:bg-gold-soft"
      >
        SIGN OUT
      </button>
    </form>
  );

  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${inter.variable} ${geistMono.variable} ${ibmPlexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <header className="bg-navy text-white print:hidden">
          <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-4 px-4 sm:gap-8 sm:px-6">
            <Link href="/" className="flex min-w-0 items-baseline gap-3">
              <span className="font-serif text-[22px] font-semibold leading-none">Rockport</span>
              {/* The tagline is the first thing to go: it is identity, not
                  navigation, and it costs 180px a phone does not have. */}
              <span className="hidden text-[10.5px] font-semibold tracking-[0.14em] text-on-navy-muted uppercase sm:inline">
                construction manager
              </span>
            </Link>
            {user ? (
              <>
                <nav className="ml-auto hidden items-center gap-6 text-sm text-on-navy-muted sm:flex">
                  {navLinks.map((l) => (
                    <TopNavLink key={l.href} href={l.href}>
                      {l.label}
                    </TopNavLink>
                  ))}
                  <span className="text-xs text-on-navy-muted">{who}</span>
                  {signOutButton}
                </nav>
                <div className="ml-auto sm:hidden">
                  <MobileNav links={navLinks} who={who} signOut={signOutButton} />
                </div>
              </>
            ) : (
              <nav className="ml-auto flex items-center gap-6 text-sm text-on-navy-muted">
                <Link href="/sign-in" className="transition-colors hover:text-white">
                  Sign in
                </Link>
              </nav>
            )}
          </div>
        </header>
        {/* Print drops the app chrome and the reading gutter: a printed page is
            the document, not a screenshot of the app. */}
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-5 sm:px-6 sm:py-8 print:max-w-none print:p-0">
          {children}
        </main>
        <Toaster />
      </body>
    </html>
  );
}

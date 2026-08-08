import type { Metadata } from "next";
import { Newsreader, Inter, Geist_Mono, IBM_Plex_Mono } from "next/font/google";
import Link from "next/link";
import { and, eq, isNull } from "drizzle-orm";
import { Toaster } from "@/components/ui/sonner";
import { TopNavLink } from "@/components/top-nav-link";
import { createClient } from "@/lib/supabase/server";
import { db, schema } from "@/db";
import { signOut } from "@/lib/actions/auth";
import "./globals.css";

// Display serif — wordmark, page titles, and card titles only.
const newsreader = Newsreader({
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

  return (
    <html
      lang="en"
      className={`${newsreader.variable} ${inter.variable} ${geistMono.variable} ${ibmPlexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <header className="bg-navy text-white">
          <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-8 px-6">
            <Link href="/" className="flex items-baseline gap-3">
              <span className="font-serif text-[22px] font-semibold leading-none">Rockport</span>
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-on-navy-muted">
                construction manager
              </span>
            </Link>
            <nav className="ml-auto flex items-center gap-6 text-sm text-on-navy-muted">
              {user ? (
                <>
                  <TopNavLink href="/">Portfolio</TopNavLink>
                  <TopNavLink href="/schedule">Schedule</TopNavLink>
                  <TopNavLink href="/vendors">Vendors</TopNavLink>
                  <TopNavLink href="/settings">Settings</TopNavLink>
                  <span className="text-xs text-on-navy-muted">
                    {profile?.fullName ?? user.email}
                    {profile?.role ? ` · ${ROLE_LABEL[profile.role] ?? profile.role}` : ""}
                  </span>
                  <form action={signOut}>
                    <button
                      type="submit"
                      className="rounded-control bg-gold px-4 py-2 text-xs font-bold tracking-[0.03em] text-navy transition-colors hover:bg-gold-soft"
                    >
                      SIGN OUT
                    </button>
                  </form>
                </>
              ) : (
                <Link href="/sign-in" className="transition-colors hover:text-white">
                  Sign in
                </Link>
              )}
            </nav>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>
        <Toaster />
      </body>
    </html>
  );
}

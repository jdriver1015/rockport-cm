import type { Metadata } from "next";
import { Playfair_Display, Mulish, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { Toaster } from "@/components/ui/sonner";
import { createClient } from "@/lib/supabase/server";
import { db, schema } from "@/db";
import { signOut } from "@/lib/actions/auth";
import "./globals.css";

// Display serif — wordmark, page titles, and large currency values only.
const playfair = Playfair_Display({
  variable: "--font-serif",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

// UI / body sans — all navigation, labels, tables, and body copy.
const mulish = Mulish({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
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

  const profile = user
    ? await db().query.profiles.findFirst({ where: eq(schema.profiles.id, user.id) })
    : null;

  return (
    <html
      lang="en"
      className={`${playfair.variable} ${mulish.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <header className="bg-navy text-white">
          <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-8 px-6">
            <Link href="/" className="flex items-baseline gap-3">
              <span className="font-serif text-[22px] font-semibold leading-none">Rockport</span>
              <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#8FA0BA]">
                construction manager
              </span>
            </Link>
            <nav className="ml-auto flex items-center gap-6 text-sm text-[#CBD5E4]">
              {user ? (
                <>
                  <Link href="/" className="transition-colors hover:text-white">
                    Portfolio
                  </Link>
                  <Link href="/vendors" className="transition-colors hover:text-white">
                    Vendors
                  </Link>
                  <Link href="/settings" className="transition-colors hover:text-white">
                    Settings
                  </Link>
                  <span className="text-xs text-[#8FA0BA]">
                    {profile?.fullName ?? user.email}
                    {profile?.role ? ` · ${ROLE_LABEL[profile.role] ?? profile.role}` : ""}
                  </span>
                  <form action={signOut}>
                    <button
                      type="submit"
                      className="rounded-[5px] border border-gold px-3.5 py-1.5 text-xs font-bold uppercase tracking-[0.08em] text-gold-soft transition-colors hover:bg-gold hover:text-white"
                    >
                      Sign out
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

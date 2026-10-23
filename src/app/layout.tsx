import type { Metadata, Viewport } from "next";
import { Source_Serif_4, Inter, Geist_Mono, IBM_Plex_Mono } from "next/font/google";
import Link from "next/link";
import { Toaster } from "@/components/ui/sonner";
import { TopNavLink } from "@/components/top-nav-link";
import { MobileNav } from "@/components/mobile-nav";
import "./globals.css";

// Display serif — wordmark, page titles, and card titles only. Fraunces read
// as too quirky at heading sizes (its soft, exaggerated curves are the whole
// point of that typeface); Source Serif 4 keeps the same editorial register
// with plain, contemporary letterforms instead.
const sourceSerif = Source_Serif_4({
  variable: "--font-serif",
  subsets: ["latin"],
  // Every font-serif heading in the app pairs it with font-semibold (600) —
  // no weight-500 usage exists, so that file would only add dead weight.
  weight: ["600"],
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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const navLinks = [
    { href: "/", label: "Portfolio" },
    { href: "/schedule", label: "Schedule" },
    { href: "/vendors", label: "Vendors" },
    { href: "/settings", label: "Settings" },
  ];
  const who = "Sandbox · demo data";

  return (
    <html
      lang="en"
      className={`${sourceSerif.variable} ${inter.variable} ${geistMono.variable} ${ibmPlexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <header className="bg-navy text-white print:hidden">
          <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-4 px-4 sm:gap-8 sm:px-6">
            <Link href="/" className="flex min-w-0 items-baseline gap-3">
              <span className="font-serif text-[22px] font-semibold leading-none">Rockport</span>
              {/* The tagline is the first thing to go: it is identity, not
                  navigation, and it costs 180px a phone does not have. */}
              <span className="hidden text-[10.5px] font-semibold tracking-[0.14em] text-on-navy-muted uppercase lg:inline">
                construction manager
              </span>
            </Link>
            {/* Four links and a label do not fit in one 64px row until well past
                tablet width, so this switches at `lg`, not `sm`. `min-w-0 truncate`
                on the label is the backstop for narrow screens. */}
            <nav className="ml-auto hidden items-center gap-6 text-sm text-on-navy-muted lg:flex">
              {navLinks.map((l) => (
                <TopNavLink key={l.href} href={l.href}>
                  {l.label}
                </TopNavLink>
              ))}
              <span className="min-w-0 max-w-[200px] truncate rounded-control bg-gold px-3 py-1 text-xs font-bold tracking-[0.03em] text-navy">
                {who}
              </span>
            </nav>
            <div className="ml-auto lg:hidden">
              <MobileNav links={navLinks} who={who} />
            </div>
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

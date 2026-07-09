import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Westcreek Construction Manager",
  description: "Portfolio construction tracking: budgets, GL intake, unit turns",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <header className="bg-[#1b355d] text-white">
          <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-8 px-6">
            <Link href="/" className="flex items-baseline gap-2">
              <span className="text-lg font-semibold tracking-[0.18em]">westcreek</span>
              <span className="text-[10px] font-medium uppercase tracking-[0.28em] text-[#a3c6e1]">
                construction manager
              </span>
            </Link>
            <nav className="ml-auto flex items-center gap-6 text-sm text-[#c6d5e6]">
              <Link href="/" className="transition-colors hover:text-white">
                Portfolio
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>
        <Toaster />
      </body>
    </html>
  );
}

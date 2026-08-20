"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * Second-level nav inside Unit Upgrades. The section now holds two different
 * kinds of thing — the units being turned, and the renovation types that define
 * what a turn IS — so a single page can't carry both.
 *
 * Deliberately styled a step quieter than PropertyNav so the two levels don't
 * compete: pill-shaped rather than underlined.
 */
const tabs = [
  { href: "", label: "Units" },
  { href: "/types", label: "Renovation types" },
];

export function InteriorNav({ slug }: { slug: string }) {
  const pathname = usePathname();
  const base = `/properties/${slug}/interiors`;
  return (
    <nav className="flex gap-1">
      {tabs.map((t) => {
        const href = `${base}${t.href}`;
        const active = t.href === "" ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={t.href}
            href={href}
            className={cn(
              "rounded-control px-3 py-1.5 text-sm font-medium transition-colors",
              active
                ? "bg-navy text-white"
                : "text-muted-foreground hover:bg-track hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

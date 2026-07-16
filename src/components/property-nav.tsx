"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const tabs = [
  { href: "/budget", label: "Budget" },
  { href: "", label: "Projects" },
  { href: "/gl", label: "Ledger" },
  { href: "/audits", label: "Site Audits" },
];

export function PropertyNav({ propertyId }: { propertyId: number }) {
  const pathname = usePathname();
  const base = `/properties/${propertyId}`;
  return (
    <nav className="flex gap-1 border-b">
      {tabs.map((t) => {
        const href = `${base}${t.href}`;
        const active =
          t.href === "" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={t.href}
            href={href}
            className={cn(
              "-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors",
              active
                ? "border-gold font-bold text-navy"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

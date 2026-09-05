"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

// Turn Plan and Site Audits are deliberately absent. The turn programme's own
// page held nothing the Projects board and the Budget tab's Interior view do not
// already own, and site audits are reached from the project they belong to (the
// project Manage menu), which is where they are actually used — the feature
// itself still backs pre-walks and the phase gates.
const tabs = [
  { href: "/executive", label: "Executive" },
  { href: "/budget", label: "Budget" },
  { href: "", label: "Projects" },
  { href: "/gl", label: "Ledger" },
  { href: "/rent-rolls", label: "Performance" },
];

export function PropertyNav({ slug }: { slug: string }) {
  const pathname = usePathname();
  const base = `/properties/${slug}`;
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
                ? "border-navy font-bold text-navy"
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

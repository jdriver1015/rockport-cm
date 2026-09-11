"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const tabs = [
  { href: "/settings/chart-of-accounts", label: "Chart of Accounts" },
  { href: "/settings/renovation-types", label: "Renovation Types" },
  { href: "/settings/contract-template", label: "Contract Template" },
  { href: "/settings/users", label: "Users" },
];

export function SettingsNav() {
  const pathname = usePathname();
  return (
    // Four tabs at their natural width run past a phone's screen with nothing
    // to wrap onto — scrolling, not wrapping, keeps every tab a single line
    // and reachable, the same call PropertyNav makes for its own row.
    <nav className="flex gap-1 overflow-x-auto border-b [&::-webkit-scrollbar]:hidden">
      {tabs.map((t) => {
        const active = pathname === t.href || pathname.startsWith(`${t.href}/`);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              "-mb-px shrink-0 border-b-2 px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors",
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

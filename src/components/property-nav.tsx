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
  // Restored. Walks were reachable only from a project's manage menu or a
  // direct link after the tab was retired, which made the whole feature
  // invisible — including to the person whose job is walking the site.
  { href: "/audits", label: "Site Walks" },
];

export function PropertyNav({ slug }: { slug: string }) {
  const pathname = usePathname();
  const base = `/properties/${slug}`;
  return (
    // Hidden on a phone. Executive, Budget, Ledger and Performance are dense
    // desk surfaces — pivots, ledgers, rent-roll trends — and none of them is
    // what somebody standing in a building needs. On a phone the property page
    // IS its projects, so the tab strip has nothing to switch between and the
    // navigation is properties → projects → project. It scrolls rather than
    // squashes from sm up, where five tabs still exceed a narrow tablet.
    <nav className="hidden gap-1 overflow-x-auto border-b sm:flex [&::-webkit-scrollbar]:hidden">
      {tabs.map((t) => {
        const href = `${base}${t.href}`;
        const active =
          t.href === "" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={t.href}
            href={href}
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

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * Top-bar nav item. The active item is white text over a 2px gold underline —
 * the only place gold appears besides the sign-out button.
 */
export function TopNavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  // "/" only matches the portfolio root; every other href matches its subtree.
  const active = href === "/" ? pathname === "/" || pathname.startsWith("/properties") : pathname.startsWith(href);

  return (
    <Link
      href={href}
      className={cn(
        "border-b-2 pb-0.5 transition-colors",
        active ? "border-gold text-white" : "border-transparent hover:text-white",
      )}
    >
      {children}
    </Link>
  );
}

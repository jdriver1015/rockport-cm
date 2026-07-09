"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const tabs = [
  { href: "", label: "Overview" },
  { href: "/budget", label: "Budget" },
];

export function ProjectNav({ projectId }: { projectId: number }) {
  const pathname = usePathname();
  const base = `/projects/${projectId}`;
  return (
    <nav className="flex gap-1 border-b">
      {tabs.map((t) => {
        const href = `${base}${t.href}`;
        const active = pathname === href;
        return (
          <Link
            key={t.href}
            href={href}
            className={cn(
              "-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors",
              active
                ? "border-[#1b355d] text-[#1b355d]"
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

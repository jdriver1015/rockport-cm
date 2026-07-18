"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

const tabs = [
  { href: "/schedule/agenda", label: "Agenda" },
  { href: "/schedule/calendar", label: "Calendar" },
  { href: "/schedule/gantt", label: "Gantt" },
];

const selectClass =
  "h-8 rounded-md border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50";

export type PropertyOption = { id: number; name: string };

export function ScheduleNav({ properties }: { properties: PropertyOption[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedProperty = searchParams.get("property") ?? "";

  function handlePropertyChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set("property", value);
    else params.delete("property");
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b">
      <nav className="flex gap-1">
        {tabs.map((t) => {
          const active = pathname === t.href;
          return (
            <Link
              key={t.href}
              href={`${t.href}${selectedProperty ? `?property=${selectedProperty}` : ""}`}
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
      <select
        value={selectedProperty}
        onChange={(e) => handlePropertyChange(e.target.value)}
        className={cn(selectClass, "mb-2")}
      >
        <option value="">All properties</option>
        {properties.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </div>
  );
}

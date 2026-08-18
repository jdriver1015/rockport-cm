"use client";

import { useRouter } from "next/navigation";
import { TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

/**
 * True when a click landed on something that handles its own activation — a
 * link, a button, a form control. Rows that navigate on click must ignore
 * those: a nested <Link> already navigates, so letting the row navigate too
 * fires two competing routes for one click and the browser ends up going
 * nowhere. Anchors are kept inside these rows on purpose (keyboard focus,
 * middle-click, open-in-new-tab), so the row has to yield rather than the
 * anchor being removed.
 */
export function isInteractiveTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest("a, button, input, select, textarea, label, [role='menuitem'], [data-slot='dropdown-menu-trigger']") !==
      null
  );
}

/**
 * A `TableRow` that navigates on click anywhere in the row, not just a link in
 * one cell — the row itself carries the hover/cursor affordance.
 */
export function ClickableTableRow({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  return (
    <TableRow
      onClick={(e) => {
        if (isInteractiveTarget(e.target)) return;
        router.push(href);
      }}
      className={cn("cursor-pointer hover:bg-track", className)}
    >
      {children}
    </TableRow>
  );
}

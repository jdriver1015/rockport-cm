"use client";

import { useRouter } from "next/navigation";
import { TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

/**
 * A `TableRow` that navigates on click anywhere in the row, not just a link in
 * one cell — the row itself carries the hover/cursor affordance instead of a
 * single cell's link having its own distinct hover state.
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
    <TableRow onClick={() => router.push(href)} className={cn("cursor-pointer hover:bg-muted/50", className)}>
      {children}
    </TableRow>
  );
}

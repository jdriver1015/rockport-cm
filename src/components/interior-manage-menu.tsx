"use client";

import Link from "next/link";
import { ChevronDownIcon, SlidersHorizontalIcon, GitBranchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Access to the two things that define a turn rather than list them — the
 * renovation types and the rule that picks between them.
 *
 * A menu rather than tabs: both are set up occasionally and revisited rarely,
 * so they don't earn permanent space beside a screen someone opens daily. The
 * items render as real links so they can be opened in a new tab.
 */
export function InteriorManageMenu({ slug }: { slug: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" />}>
        Manage
        <ChevronDownIcon className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem render={<Link href={`/properties/${slug}/interiors/types`} />}>
          <SlidersHorizontalIcon />
          Renovation types
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link href={`/properties/${slug}/interiors/triggers`} />}>
          <GitBranchIcon />
          Triggers
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { setProjectManager } from "@/lib/actions/projects";
import { managerInitials, type ManagerOption } from "@/lib/project-managers";

/**
 * The manager cell, and the picker behind it.
 *
 * Assigning happens here rather than only on the project's own page because the
 * first pass over a property is a pass over the whole list: thirteen projects,
 * nobody named on any of them. Sending that through thirteen page loads is the
 * reason a "who owns this" column would go unfilled.
 *
 * A `viewer` or `site` reader gets the same cell without the trigger — the name
 * is information they need, the assignment is not theirs to change.
 */
export function ProjectManagerCell({
  projectId,
  managerId,
  managerName,
  roster,
  canAssign,
}: {
  projectId: number;
  managerId: string | null;
  /**
   * The assigned person's name, read off the project rather than looked up in
   * `roster` — somebody who has since left the roster still holds the projects
   * they were running, and the cell has to keep saying so.
   */
  managerName: string | null;
  roster: ManagerOption[];
  canAssign: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function assign(nextId: string | null, label: string) {
    const fd = new FormData();
    fd.set("projectId", String(projectId));
    if (nextId) fd.set("managerId", nextId);
    startTransition(async () => {
      const result = await setProjectManager(fd);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(label);
      router.refresh();
    });
  }

  const face = managerName ? (
    <span className="flex min-w-0 items-center gap-2">
      <span
        className="grid size-[22px] shrink-0 place-items-center rounded-full bg-track text-[9.5px] font-bold text-ink-500"
        aria-hidden
      >
        {managerInitials(managerName)}
      </span>
      <span className="truncate text-[13px] text-ink-500">{managerName}</span>
    </span>
  ) : (
    <span className="flex min-w-0 items-center gap-2">
      <span
        className="grid size-[22px] shrink-0 place-items-center rounded-full border border-dashed border-ink-100 text-[12px] text-ink-200"
        aria-hidden
      >
        +
      </span>
      <span className="truncate text-[13px] text-ink-300">
        {canAssign ? "Assign" : "Unassigned"}
      </span>
    </span>
  );

  if (!canAssign) return <div className="min-w-0">{face}</div>;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "-mx-1.5 flex min-w-0 max-w-full items-center rounded-control px-1.5 py-0.5 text-left",
          "hover:bg-track focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
          pending && "opacity-60",
        )}
        disabled={pending}
        aria-label={managerName ? `Project manager: ${managerName}` : "Assign a project manager"}
      >
        {face}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-52">
        {roster.length === 0 ? (
          <DropdownMenuItem disabled>Nobody on the roster yet</DropdownMenuItem>
        ) : (
          roster.map((person) => (
            <DropdownMenuItem
              key={person.id}
              onClick={() => {
                if (person.id === managerId) return;
                assign(person.id, `${person.name} assigned`);
              }}
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">{person.name}</span>
                {/* Two people can share a display name; the email is what tells
                    them apart, so it is only worth the line when it adds one. */}
                {person.name !== person.email && (
                  <span className="truncate text-[11px] text-muted-foreground">{person.email}</span>
                )}
              </span>
              {person.id === managerId && <CheckIcon className="size-3.5 shrink-0" />}
            </DropdownMenuItem>
          ))
        )}
        {managerId && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => assign(null, "Manager cleared")}>
              Unassign
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

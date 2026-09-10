"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckIcon, MailIcon, PlusIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { fmtDate } from "@/lib/format";
import { managerInitials } from "@/lib/project-managers";
import {
  addWalkAttendee,
  inviteWalkAttendee,
  removeWalkAttendee,
} from "@/lib/actions/walk-attendees";
import type { AttendeeRoster, WalkAttendee } from "@/lib/walk-attendee-roster";

/**
 * Who is on the walk.
 *
 * The two kinds are visibly different because they mean different things. A
 * team member is assigned: they can open this walk and work it, so there is
 * nothing to send and nothing to accept. A vendor cannot log in, so the only
 * thing that reaches them is an email — and it is a separate press, because
 * sending mail as a side effect of adding a row is how people surprise a
 * subcontractor at 9pm.
 */
export function WalkAttendees({
  auditId,
  attendees,
  roster,
  canEdit,
}: {
  auditId: number;
  attendees: WalkAttendee[];
  roster: AttendeeRoster;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<number | null>(null);

  const onWalk = new Set(
    attendees.map((a) => (a.kind === "team" ? `p:${a.email}` : `v:${a.email}`)),
  );

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, success: string, id?: number) {
    if (id) setBusyId(id);
    startTransition(async () => {
      const res = await fn();
      setBusyId(null);
      if (!res.ok) {
        toast.error(res.error ?? "Something went wrong");
        return;
      }
      toast.success(success);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {attendees.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nobody else on this walk yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {attendees.map((a) => (
            <li key={a.id} className="flex items-center gap-3">
              <span
                className="grid size-8 shrink-0 place-items-center rounded-full bg-track text-[10px] font-bold text-ink-500"
                aria-hidden
              >
                {managerInitials(a.name)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium text-ink-700">
                  {a.name}
                </span>
                <span className="block truncate text-[11.5px] text-muted-foreground">
                  {a.kind === "team" ? (
                    <>Team{a.role !== "required" ? ` · ${a.role}` : ""}</>
                  ) : (
                    <>
                      {a.company ?? "Vendor"}
                      {a.invitedAt ? ` · invited ${fmtDate(a.invitedAt)}` : " · not invited yet"}
                    </>
                  )}
                </span>
              </span>

              {canEdit && a.kind === "vendor" && (
                <Button
                  size="sm"
                  variant={a.invitedAt ? "ghost" : "outline"}
                  disabled={pending && busyId === a.id}
                  onClick={() =>
                    run(
                      () => inviteWalkAttendee({ id: a.id }),
                      `Invitation sent to ${a.name}`,
                      a.id,
                    )
                  }
                >
                  {a.invitedAt ? (
                    <>
                      <CheckIcon className="size-3.5" />
                      Re-send
                    </>
                  ) : (
                    <>
                      <MailIcon className="size-3.5" />
                      Invite
                    </>
                  )}
                </Button>
              )}

              {canEdit && (
                <button
                  type="button"
                  aria-label={`Remove ${a.name}`}
                  disabled={pending}
                  onClick={() =>
                    run(() => removeWalkAttendee({ id: a.id }), `${a.name} removed`, a.id)
                  }
                  className="grid size-9 shrink-0 place-items-center rounded-control text-ink-300 hover:text-alert"
                >
                  <XIcon className="size-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <DropdownMenu>
          {/* Button renders a real <button>, so nativeButton stays true —
              passing false here is the inverse mistake to the one the scope
              editors had, and Base UI warns about both. */}
          <DropdownMenuTrigger render={<Button variant="outline" size="sm" className="h-9" />}>
            <PlusIcon className="size-4" />
            Add someone
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-80 min-w-64 overflow-y-auto">
            <DropdownMenuLabel>Team — assigned</DropdownMenuLabel>
            {roster.team.length === 0 && <DropdownMenuItem disabled>Nobody on the roster</DropdownMenuItem>}
            {roster.team.map((t) => (
              <DropdownMenuItem
                key={t.profileId}
                disabled={onWalk.has(`p:${t.email}`)}
                onClick={() =>
                  run(
                    () => addWalkAttendee({ auditId, profileId: t.profileId }),
                    `${t.name} added to the walk`,
                  )
                }
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{t.name}</span>
                  <span className="truncate text-[11px] text-muted-foreground">{t.email}</span>
                </span>
              </DropdownMenuItem>
            ))}

            <DropdownMenuSeparator />
            <DropdownMenuLabel>Vendors — invited by email</DropdownMenuLabel>
            {roster.vendors.length === 0 && (
              <DropdownMenuItem disabled>No vendor contacts with an email</DropdownMenuItem>
            )}
            {roster.vendors.map((v) => (
              <DropdownMenuItem
                key={v.vendorContactId}
                disabled={onWalk.has(`v:${v.email}`)}
                onClick={() =>
                  run(
                    () => addWalkAttendee({ auditId, vendorContactId: v.vendorContactId }),
                    `${v.name} added — invite them when you are ready`,
                  )
                }
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{v.name}</span>
                  <span className="truncate text-[11px] text-muted-foreground">{v.vendorName}</span>
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

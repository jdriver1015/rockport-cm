"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CopyIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  deleteProfile,
  inviteUser,
  restoreProfile,
  sendSignInLink,
  updateProfile,
  type InviteDelivery,
} from "@/lib/actions/settings";
import { AUTH_ROLES, ROLE_LABELS, type AuthRole } from "@/lib/auth-rules";
import { fmtDate } from "@/lib/format";

/** Where a person's sign-in stands, worked out on the server from Supabase. */
export type AccessKind = "not_invited" | "invited" | "active";

const SELECT_CLASS =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50";

/** The send button's wording follows what the person needs next. */
const SEND_LABEL: Record<AccessKind, string> = {
  not_invited: "Send invite",
  invited: "Resend invite",
  active: "Send password reset",
};

/**
 * What to tell the admin after an invite or reset — and, when the email could
 * not go out, the link itself to pass on, so the person is never stranded on a
 * mail setting nobody has configured yet.
 */
function DeliveryNotice({
  delivery,
  email,
}: {
  delivery: Extract<InviteDelivery, { delivered: false }>;
  email: string;
}) {
  async function copy(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Link copied");
    } catch {
      toast.info(link, { duration: 20000 });
    }
  }

  return (
    <div className="space-y-3 rounded-card border border-gold/40 bg-gold/8 p-3">
      <p className="text-[13px] text-ink-600">
        The email to <span className="font-medium text-navy">{email}</span> wasn&apos;t sent:{" "}
        {delivery.reason}
      </p>
      {delivery.link && (
        <>
          <p className="text-[12.5px] text-muted-foreground">
            Send them this link yourself. It signs them in once and opens &ldquo;set your
            password&rdquo;, then stops working — don&apos;t share it with anyone else.
          </p>
          <div className="flex gap-2">
            <Input readOnly value={delivery.link} className="h-8 font-mono text-[11px]" aria-label="Sign-in link" />
            <Button type="button" size="sm" variant="outline" onClick={() => copy(delivery.link!)}>
              <CopyIcon className="size-3.5" />
              Copy
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function deliveredMessage(kind: InviteDelivery["kind"], email: string): string {
  return kind === "reset" ? `Password reset sent to ${email}` : `Invite sent to ${email}`;
}

export function AddUserDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Set when the invite could not be emailed — the dialog then shows the link
  // to pass on instead of closing.
  const [undelivered, setUndelivered] = useState<{
    delivery: Extract<InviteDelivery, { delivered: false }>;
    email: string;
  } | null>(null);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setUndelivered(null);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={<Button size="sm" />}>Add user</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{undelivered ? "User added" : "Invite a user"}</DialogTitle>
          <DialogDescription>
            {undelivered
              ? "They're on the roster with their role."
              : "They'll get a welcome email with a link to set their own password. Nobody else ever sees it."}
          </DialogDescription>
        </DialogHeader>

        {undelivered ? (
          <div className="space-y-4">
            <DeliveryNotice delivery={undelivered.delivery} email={undelivered.email} />
            <div className="flex justify-end">
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </div>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              const email = String(fd.get("email") ?? "").trim().toLowerCase();
              setBusy(true);
              try {
                const result = await inviteUser(fd);
                if (!result.ok) {
                  toast.error(result.error);
                  return;
                }
                router.refresh();
                if (result.delivery.delivered) {
                  toast.success(deliveredMessage(result.delivery.kind, email));
                  onOpenChange(false);
                } else {
                  setUndelivered({ delivery: result.delivery, email });
                }
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Could not add user");
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="u-email">Email</Label>
              <Input id="u-email" name="email" type="email" required placeholder="name@westcreek-capital.com" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="u-name">Full name</Label>
              <Input id="u-name" name="fullName" placeholder="Jane Driver" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="u-role">Role</Label>
              <select id="u-role" name="role" defaultValue="viewer" className={SELECT_CLASS}>
                {AUTH_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex justify-end">
              <Button type="submit" disabled={busy}>
                {busy ? "Sending…" : "Send invite"}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function UserDetailDialog({
  id,
  fullName,
  email,
  role,
  createdAt,
  access,
  accessLabel,
  isSelf,
}: {
  id: string;
  fullName: string | null;
  email: string;
  role: AuthRole;
  createdAt: string | Date;
  access: AccessKind;
  /** "Invited Oct 1", "Last signed in Sep 30"… */
  accessLabel: string;
  /** The admin looking at their own row — removing it is refused. */
  isSelf: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sending, startSend] = useTransition();
  const [undelivered, setUndelivered] = useState<Extract<InviteDelivery, { delivered: false }> | null>(
    null,
  );

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setUndelivered(null);
  }

  async function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await updateProfile(new FormData(e.currentTarget));
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("User updated");
      onOpenChange(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function handleSend() {
    setUndelivered(null);
    startSend(async () => {
      const result = await sendSignInLink(id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      router.refresh();
      if (result.delivery.delivered) toast.success(deliveredMessage(result.delivery.kind, email));
      else setUndelivered(result.delivery);
    });
  }

  function handleRemove() {
    setBusy(true);
    (async () => {
      try {
        const result = await deleteProfile(id);
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        toast.success("User removed — they can no longer sign in", {
          action: {
            label: "Undo",
            onClick: () => {
              void (async () => {
                const undo = await restoreProfile(id);
                if (!undo.ok) toast.error(undo.error);
                router.refresh();
              })();
            },
          },
        });
        onOpenChange(false);
        router.refresh();
      } finally {
        setBusy(false);
      }
    })();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={<Button size="sm" variant="ghost" />}>Edit</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{fullName || email}</DialogTitle>
          <DialogDescription>
            Added {fmtDate(createdAt)} · {accessLabel}
          </DialogDescription>
        </DialogHeader>

        {/* Getting them signed in sits above the edit form: it is the thing an
            admin opens this for when someone says "I never got the email". */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-muted/30 px-3 py-2.5">
          <p className="min-w-0 flex-1 text-[12.5px] text-muted-foreground">
            {access === "not_invited"
              ? "No invite sent yet."
              : access === "invited"
                ? "Hasn't set a password yet."
                : "Signs in with their own password."}
          </p>
          <Button size="sm" variant="outline" disabled={sending} onClick={handleSend}>
            {sending ? "Sending…" : SEND_LABEL[access]}
          </Button>
        </div>
        {undelivered && <DeliveryNotice delivery={undelivered} email={email} />}

        <form className="space-y-4" onSubmit={handleSave}>
          <input type="hidden" name="id" value={id} />
          <div className="space-y-1.5">
            <Label htmlFor={`u-name-${id}`}>Full name</Label>
            <Input
              id={`u-name-${id}`}
              name="fullName"
              defaultValue={fullName ?? ""}
              placeholder="Jane Driver"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`u-email-${id}`}>Email</Label>
            <Input id={`u-email-${id}`} name="email" type="email" required defaultValue={email} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`u-role-${id}`}>Role</Label>
            <select id={`u-role-${id}`} name="role" defaultValue={role} className={SELECT_CLASS}>
              {AUTH_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center justify-between gap-2 border-t pt-3">
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={busy || isSelf}
              title={isSelf ? "You can't remove yourself" : undefined}
              onClick={handleRemove}
            >
              Remove
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RestoreUserButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          const result = await restoreProfile(id);
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          toast.success("User restored — they can sign in again");
          router.refresh();
        });
      }}
    >
      {pending ? "Restoring…" : "Restore"}
    </Button>
  );
}

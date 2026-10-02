import Link from "next/link";
import { asc, isNotNull, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AddUserDialog,
  RestoreUserButton,
  UserDetailDialog,
  type AccessKind,
} from "@/components/user-editors";
import { fmtDate } from "@/lib/format";
import { requireUser } from "@/lib/auth";
import { ROLE_LABELS, canAdminProperty, type AuthRole } from "@/lib/auth-rules";
import { readAuthStatuses, type AuthStatus } from "@/lib/user-access";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = ROLE_LABELS;

/** Where a person's sign-in stands, in a word and a date. */
function accessOf(status: AuthStatus | undefined): { kind: AccessKind; label: string } {
  if (!status) return { kind: "not_invited", label: "Not invited" };
  if (status.lastSignInAt) {
    return { kind: "active", label: `Last signed in ${fmtDate(status.lastSignInAt)}` };
  }
  return {
    kind: "invited",
    label: status.linkSentAt ? `Invited ${fmtDate(status.linkSentAt)}` : "Invited",
  };
}

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const showArchived = sp.archived === "1";

  // Managing people is admin-only; the actions refuse anyone else, and the
  // page says so rather than offering buttons that will.
  const auth = await requireUser();
  if (!auth.ok || !canAdminProperty(auth.profile.role)) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Only an admin can manage users.
      </p>
    );
  }

  const [users, archivedCount, statuses] = await Promise.all([
    db()
      .select()
      .from(schema.profiles)
      .where(showArchived ? isNotNull(schema.profiles.archivedAt) : isNull(schema.profiles.archivedAt))
      .orderBy(asc(schema.profiles.email)),
    db().$count(schema.profiles, isNotNull(schema.profiles.archivedAt)),
    readAuthStatuses(),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {users.length} {showArchived ? "archived " : ""}user{users.length === 1 ? "" : "s"}
          {!showArchived && " · invite people to sign in; roles control what each can do"}
        </p>
        <div className="flex items-center gap-3">
          {archivedCount > 0 && (
            <Link
              href={showArchived ? "/settings/users" : "/settings/users?archived=1"}
              className="text-sm text-link hover:underline"
            >
              {showArchived ? "Back to active" : `Archived (${archivedCount})`}
            </Link>
          )}
          <AddUserDialog />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base text-navy">
            {showArchived ? "Archived users" : "Users & roles"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {users.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {showArchived ? (
                "No archived users."
              ) : (
                <>
                  No users yet. Click <span className="font-medium">Add user</span> to build the
                  roster.
                </>
              )}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Access</TableHead>
                  <TableHead className="text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => {
                  const access = accessOf(statuses.get(u.id));
                  return (
                    <TableRow key={u.id}>
                      <TableCell className="font-medium text-navy">
                        {u.fullName ?? "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{u.email}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {ROLE_LABEL[u.role] ?? u.role}
                      </TableCell>
                      <TableCell
                        className={
                          showArchived
                            ? "text-muted-foreground"
                            : access.kind === "active"
                              ? "text-ink-500"
                              : access.kind === "invited"
                                ? "text-amber-700"
                                : "text-muted-foreground"
                        }
                      >
                        {showArchived ? "Sign-in blocked" : access.label}
                      </TableCell>
                      <TableCell className="text-right">
                        {showArchived ? (
                          <RestoreUserButton id={u.id} />
                        ) : (
                          <UserDetailDialog
                            id={u.id}
                            fullName={u.fullName}
                            email={u.email}
                            role={u.role as AuthRole}
                            createdAt={u.createdAt}
                            access={access.kind}
                            accessLabel={access.label}
                            isSelf={u.id === auth.profile.id}
                          />
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {!showArchived && (
        <p className="text-xs text-muted-foreground">
          Role labels shown: {Object.values(ROLE_LABEL).join(", ")}.
        </p>
      )}
    </div>
  );
}

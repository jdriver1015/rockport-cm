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
import { AddUserDialog, RestoreUserButton, UserDetailDialog } from "@/components/user-editors";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  cm: "Construction Manager",
  site: "Site staff",
  viewer: "Viewer",
};

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const showArchived = sp.archived === "1";

  const [users, archivedCount] = await Promise.all([
    db()
      .select()
      .from(schema.profiles)
      .where(showArchived ? isNotNull(schema.profiles.archivedAt) : isNull(schema.profiles.archivedAt))
      .orderBy(asc(schema.profiles.email)),
    db().$count(schema.profiles, isNotNull(schema.profiles.archivedAt)),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {users.length} {showArchived ? "archived " : ""}user{users.length === 1 ? "" : "s"}
          {!showArchived && " · roles control what each person can do"}
        </p>
        <div className="flex items-center gap-3">
          {archivedCount > 0 && (
            <Link
              href={showArchived ? "/settings/users" : "/settings/users?archived=1"}
              className="text-sm text-gold-link hover:underline"
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
                  <TableHead>Added</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium text-navy">
                      {u.fullName ?? "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{u.email}</TableCell>
                    <TableCell className="text-muted-foreground">{fmtDate(u.createdAt)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {ROLE_LABEL[u.role] ?? u.role}
                    </TableCell>
                    <TableCell className="text-right">
                      {showArchived ? (
                        <RestoreUserButton id={u.id} />
                      ) : (
                        <UserDetailDialog
                          id={u.id}
                          fullName={u.fullName}
                          email={u.email}
                          role={u.role as "admin" | "cm" | "site" | "viewer"}
                          createdAt={u.createdAt}
                        />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
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

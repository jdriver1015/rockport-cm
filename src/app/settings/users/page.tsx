import { asc } from "drizzle-orm";
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
import { AddUserDialog, UserRowActions } from "@/components/user-editors";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  cm: "Construction Manager",
  site: "Site staff",
  viewer: "Viewer",
};

export default async function UsersPage() {
  const users = await db()
    .select()
    .from(schema.profiles)
    .orderBy(asc(schema.profiles.email));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {users.length} user{users.length === 1 ? "" : "s"} · roles control what each person can do
        </p>
        <AddUserDialog />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base text-[#1b355d]">Users &amp; roles</CardTitle>
        </CardHeader>
        <CardContent>
          {users.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No users yet. Click <span className="font-medium">Add user</span> to build the roster.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Added</TableHead>
                  <TableHead className="text-right">Role</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium text-[#1b355d]">
                      {u.fullName ?? "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{u.email}</TableCell>
                    <TableCell className="text-muted-foreground">{fmtDate(u.createdAt)}</TableCell>
                    <TableCell>
                      <UserRowActions
                        id={u.id}
                        role={u.role as "admin" | "cm" | "site" | "viewer"}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Role labels shown: {Object.values(ROLE_LABEL).join(", ")}. Sign-in isn&apos;t wired up yet —
        these entries reserve each person&apos;s access for when it is.
      </p>
    </div>
  );
}

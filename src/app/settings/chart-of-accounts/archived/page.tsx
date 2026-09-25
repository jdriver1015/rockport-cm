import Link from "next/link";
import { desc, isNotNull } from "drizzle-orm";
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
import { ClickableTableRow } from "@/components/ui/clickable-table-row";
import { RestoreChartButton } from "@/components/chart-list";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

/** Built on the same shell as the other archived lists — see properties/archived/page.tsx. */
export default async function ArchivedChartsPage() {
  const archived = await db()
    .select()
    .from(schema.chartsOfAccounts)
    .where(isNotNull(schema.chartsOfAccounts.archivedAt))
    .orderBy(desc(schema.chartsOfAccounts.archivedAt));

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm">
          <Link href="/settings/chart-of-accounts" className="text-link hover:underline">
            ← Charts of accounts
          </Link>
        </p>
        <h1 className="mt-1 font-serif text-2xl font-semibold text-navy">Archived charts</h1>
        <p className="text-sm text-muted-foreground">
          Hidden from the chart picker. Nothing has been deleted — its categories, cost codes and
          mapping rules are all still attached, and restoring puts it back exactly as it was.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base text-navy">
            {archived.length} archived chart{archived.length === 1 ? "" : "s"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {archived.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No archived charts. Archiving one from the charts list will list it here.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Chart</TableHead>
                    <TableHead>Archived</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {archived.map((c) => (
                    <ClickableTableRow key={c.id} href={`/settings/chart-of-accounts/${c.id}`}>
                      <TableCell>
                        <Link
                          href={`/settings/chart-of-accounts/${c.id}`}
                          className="font-medium text-navy"
                        >
                          {c.name}
                        </Link>
                        {c.description && (
                          <span className="block text-[11px] text-muted-foreground">
                            {c.description}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {fmtDate(c.archivedAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <RestoreChartButton id={c.id} />
                      </TableCell>
                    </ClickableTableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

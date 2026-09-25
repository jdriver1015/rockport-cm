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
import { RestoreTemplateButton } from "@/components/budget-template-list";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

/** Built on the same shell as the other archived lists — see properties/archived/page.tsx. */
export default async function ArchivedTemplatesPage() {
  const archived = await db()
    .select()
    .from(schema.budgetTemplates)
    .where(isNotNull(schema.budgetTemplates.archivedAt))
    .orderBy(desc(schema.budgetTemplates.archivedAt));

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm">
          <Link href="/settings/renovation-types" className="text-link hover:underline">
            ← Renovation types
          </Link>
        </p>
        <h1 className="mt-1 font-serif text-2xl font-semibold text-navy">Archived renovation types</h1>
        <p className="text-sm text-muted-foreground">
          Hidden from the library offered when creating a property or a unit upgrade. Nothing has
          been deleted — its priced lines are all still attached, and restoring puts it back
          exactly as it was.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base text-navy">
            {archived.length} archived template{archived.length === 1 ? "" : "s"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {archived.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No archived renovation types. Archiving one from the list will list it here.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Template</TableHead>
                    <TableHead>Archived</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {archived.map((t) => (
                    <ClickableTableRow key={t.id} href={`/settings/renovation-types/${t.id}`}>
                      <TableCell>
                        <Link
                          href={`/settings/renovation-types/${t.id}`}
                          className="font-medium text-navy"
                        >
                          {t.name}
                        </Link>
                        {t.description && (
                          <span className="block text-[11px] text-muted-foreground">
                            {t.description}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {fmtDate(t.archivedAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <RestoreTemplateButton id={t.id} />
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

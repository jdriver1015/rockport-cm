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
import { RestoreContractTemplateButton } from "@/components/contract-template-editor";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

/** Built on the same shell as the other archived lists — see properties/archived/page.tsx. */
export default async function ArchivedContractTemplatesPage() {
  const archived = await db()
    .select({
      id: schema.contractTemplates.id,
      name: schema.contractTemplates.name,
      archivedAt: schema.contractTemplates.archivedAt,
    })
    .from(schema.contractTemplates)
    .where(isNotNull(schema.contractTemplates.archivedAt))
    .orderBy(desc(schema.contractTemplates.archivedAt));

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm">
          <Link href="/settings/contract-template" className="text-link hover:underline">
            ← Contract template
          </Link>
        </p>
        <h1 className="mt-1 font-serif text-2xl font-semibold text-navy">Archived contract templates</h1>
        <p className="text-sm text-muted-foreground">
          Hidden from the template picker. Nothing has been deleted — every contract already
          generated from it keeps its own snapshot regardless, and restoring puts it back exactly
          as it was.
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
              No archived templates. Archiving one from the editor will list it here.
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
                    <TableRow key={t.id}>
                      <TableCell className="font-medium text-navy">{t.name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {fmtDate(t.archivedAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <RestoreContractTemplateButton id={t.id} />
                      </TableCell>
                    </TableRow>
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

import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { PropertyHeader } from "@/components/property-header";
import { PropertyNav } from "@/components/property-nav";
import { BackLink } from "@/components/ui/back-link";
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
import { RestoreGroupButton } from "@/components/renovation-type-list";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

/** Built on the same shell as the other archived lists — see properties/archived/page.tsx. */
export default async function ArchivedRenovationTypesPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const property = await db().query.properties.findFirst({
    where: eq(schema.properties.slug, slug),
  });
  if (!property) notFound();
  const propertyId = property.id;

  const archived = await db()
    .select()
    .from(schema.budgetGroups)
    .where(and(eq(schema.budgetGroups.propertyId, propertyId), isNotNull(schema.budgetGroups.archivedAt)))
    .orderBy(desc(schema.budgetGroups.archivedAt));

  return (
    <div className="space-y-6">
      <PropertyHeader property={property} />
      <PropertyNav slug={property.slug} />
      <BackLink href={`/properties/${slug}/interiors/types`} label="Renovation types" />

      <div>
        <h1 className="font-serif text-2xl font-semibold text-navy">Archived renovation types</h1>
        <p className="text-sm text-muted-foreground">
          Hidden from the interior wizard and the budget pivot. Nothing has been deleted — its
          priced lines are all still attached, and restoring puts it back exactly as it was.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base text-navy">
            {archived.length} archived type{archived.length === 1 ? "" : "s"}
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
                    <TableHead>Type</TableHead>
                    <TableHead>Archived</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {archived.map((g) => (
                    <ClickableTableRow
                      key={g.id}
                      href={`/properties/${slug}/interiors/types/${g.id}`}
                    >
                      <TableCell>
                        <Link
                          href={`/properties/${slug}/interiors/types/${g.id}`}
                          className="font-medium text-navy"
                        >
                          {g.name}
                        </Link>
                        {g.description && (
                          <span className="block text-[11px] text-muted-foreground">
                            {g.description}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {fmtDate(g.archivedAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <RestoreGroupButton id={g.id} propertyId={propertyId} />
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

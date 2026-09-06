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
import { TableCard } from "@/components/ui/table-card";
import { RestorePropertyButton } from "@/components/archive-property-dialog";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Archived properties.
 *
 * Deliberately a plain list, not the portfolio's cards: the cards exist to
 * compare live construction — budget spent, schedule health — and none of that
 * is a question you ask of a building you have taken off the board. What you
 * want here is which one it was, when it went, and how to get it back.
 */
export default async function ArchivedPropertiesPage() {
  const archived = await db()
    .select()
    .from(schema.properties)
    .where(isNotNull(schema.properties.archivedAt))
    .orderBy(desc(schema.properties.archivedAt));

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm">
          <Link href="/" className="text-link hover:underline">
            ← Portfolio
          </Link>
        </p>
        <h1 className="mt-1 font-serif text-2xl font-semibold text-navy">Archived properties</h1>
        <p className="text-sm text-muted-foreground">
          Hidden from the portfolio and the schedule. Nothing has been deleted — every budget, GL
          batch, rent roll and audit is still attached, and restoring puts the property back
          exactly as it was.
        </p>
      </div>

      {archived.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Nothing archived</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Archiving a property from its own page will list it here.
          </CardContent>
        </Card>
      ) : (
        <TableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Property</TableHead>
                <TableHead>Location</TableHead>
                <TableHead className="text-right">Units</TableHead>
                <TableHead>Archived</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {archived.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    {/* Still linked: an archived property's pages resolve by slug
                        and are worth reading — that is the point of not deleting
                        it. The header there says it is archived. */}
                    <Link
                      href={`/properties/${p.slug}`}
                      className="font-medium text-navy hover:text-link hover:underline"
                    >
                      {p.name}
                    </Link>
                    {p.entity && (
                      <span className="block text-[11px] text-muted-foreground">{p.entity}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {[p.city, p.state].filter(Boolean).join(", ") || "—"}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                    {p.unitCount ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {fmtDate(p.archivedAt ? p.archivedAt.toISOString().slice(0, 10) : null)}
                  </TableCell>
                  <TableCell className="text-right">
                    <RestorePropertyButton propertyId={p.id} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      )}
    </div>
  );
}

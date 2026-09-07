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
import { RestorePropertyButton } from "@/components/archive-property-dialog";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Archived properties.
 *
 * Built on the same shell as the other four archived lists — projects, GL
 * batches, audits, rent rolls — so this is the fifth of a kind rather than a
 * fifth variant: a counted card, an inline empty state, and rows that navigate
 * to the thing they name.
 *
 * Not the portfolio's cards, though. Those exist to compare live construction
 * (budget spent, schedule health), and none of that is a question you ask of a
 * building you have taken off the board.
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base text-navy">
            {archived.length} archived propert{archived.length === 1 ? "y" : "ies"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {archived.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No archived properties. Archiving one from its own page will list it here.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Property</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead className="text-right">Units</TableHead>
                    <TableHead>Archived</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {/* Rows navigate: an archived property's pages resolve by slug
                      and are worth reading — that is the point of not deleting
                      it. The header there says it is archived. */}
                  {archived.map((p) => (
                    <ClickableTableRow key={p.id} href={`/properties/${p.slug}`}>
                      <TableCell>
                        <Link
                          href={`/properties/${p.slug}`}
                          className="font-medium text-navy"
                        >
                          {p.name}
                        </Link>
                        {p.entity && (
                          <span className="block text-[11px] text-muted-foreground">
                            {p.entity}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {[p.city, p.state].filter(Boolean).join(", ") || "—"}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                        {p.unitCount ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {fmtDate(p.archivedAt)}
                      </TableCell>
                      {/* isInteractiveTarget already exempts buttons from the
                          row's navigation, so the restore needs no guard. */}
                      <TableCell className="text-right">
                        <RestorePropertyButton propertyId={p.id} />
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

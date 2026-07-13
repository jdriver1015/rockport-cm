import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AddGlDialog } from "@/components/add-gl-dialog";
import { PropertyNav } from "@/components/property-nav";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function GlPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const propertyId = Number(id);
  if (!Number.isInteger(propertyId)) notFound();

  const property = await db().query.properties.findFirst({
    where: eq(schema.properties.id, propertyId),
  });
  if (!property) notFound();

  const batches = await db()
    .select()
    .from(schema.importBatches)
    .where(eq(schema.importBatches.propertyId, propertyId))
    .orderBy(desc(schema.importBatches.createdAt));

  // Live per-batch counts (rows change status as they're reviewed/posted)
  const counts = await db()
    .select({
      batchId: schema.glTransactions.batchId,
      status: schema.glTransactions.status,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.glTransactions)
    .where(eq(schema.glTransactions.propertyId, propertyId))
    .groupBy(schema.glTransactions.batchId, schema.glTransactions.status);

  const byBatch = new Map<number, { queue: number; posted: number; excluded: number }>();
  for (const c of counts) {
    if (c.batchId == null) continue;
    const rec = byBatch.get(c.batchId) ?? { queue: 0, posted: 0, excluded: 0 };
    if (c.status === "staged" || c.status === "needs_review") rec.queue += c.count;
    else if (c.status === "posted") rec.posted += c.count;
    else if (c.status === "excluded") rec.excluded += c.count;
    byBatch.set(c.batchId, rec);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-semibold text-navy">{property.name}</h1>
        <p className="text-sm text-muted-foreground">
          GL intake — each import reconciles a GL export to cost codes
          {property.glUpdatedThru ? ` · GL updated thru ${fmtDate(property.glUpdatedThru)}` : ""}
        </p>
      </div>

      <PropertyNav propertyId={property.id} />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base text-navy">Import history</CardTitle>
          <AddGlDialog propertyId={property.id} />
        </CardHeader>
        <CardContent>
          {batches.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No imports yet. Click <span className="font-medium">Add GL</span> to drop your first GL
              export.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>File</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Uploaded</TableHead>
                    <TableHead className="text-right">Rows</TableHead>
                    <TableHead className="text-right">In queue</TableHead>
                    <TableHead className="text-right">Posted</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {batches.map((b) => {
                    const c = byBatch.get(b.id) ?? { queue: 0, posted: 0, excluded: 0 };
                    return (
                      <TableRow key={b.id} className="cursor-pointer">
                        <TableCell>
                          <Link
                            href={`/properties/${property.id}/gl/${b.id}`}
                            className="font-medium text-gold-link hover:underline"
                          >
                            {b.fileName}
                          </Link>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {b.sourceSystem ?? "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {fmtDate(b.createdAt)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{b.rowCount}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {c.queue > 0 ? (
                            <span className="font-medium text-[#a3641f]">{c.queue}</span>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{c.posted}</TableCell>
                        <TableCell>
                          <Badge variant={b.status === "posted" ? "positive" : "pending"}>
                            {b.status === "posted"
                              ? "posted"
                              : c.queue > 0
                                ? `${c.queue} to review`
                                : "ready"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

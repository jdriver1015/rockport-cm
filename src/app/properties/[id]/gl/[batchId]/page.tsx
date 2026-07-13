import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
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
import { GlReviewQueue } from "@/components/gl-review-queue";
import { PropertyNav } from "@/components/property-nav";
import { UnpostButton } from "@/components/unpost-button";
import { fmtDate, money } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function BatchDetailPage({
  params,
}: {
  params: Promise<{ id: string; batchId: string }>;
}) {
  const { id, batchId: bid } = await params;
  const propertyId = Number(id);
  const batchId = Number(bid);
  if (!Number.isInteger(propertyId) || !Number.isInteger(batchId)) notFound();

  const property = await db().query.properties.findFirst({
    where: eq(schema.properties.id, propertyId),
  });
  if (!property) notFound();

  const batch = await db().query.importBatches.findFirst({
    where: eq(schema.importBatches.id, batchId),
  });
  if (!batch || batch.propertyId !== propertyId) notFound();

  const costCodes = await db()
    .select({ id: schema.costCodes.id, code: schema.costCodes.code, name: schema.costCodes.name })
    .from(schema.costCodes)
    .where(eq(schema.costCodes.active, true))
    .orderBy(asc(schema.costCodes.code));

  const projects = await db()
    .select({
      id: schema.projects.id,
      name: schema.projects.name,
      kind: schema.projects.kind,
      costCodeId: schema.projects.costCodeId,
    })
    .from(schema.projects)
    .where(eq(schema.projects.propertyId, propertyId))
    .orderBy(asc(schema.projects.name));

  const queue = await db()
    .select()
    .from(schema.glTransactions)
    .where(
      and(
        eq(schema.glTransactions.batchId, batchId),
        inArray(schema.glTransactions.status, ["staged", "needs_review", "excluded"]),
      ),
    )
    .orderBy(desc(schema.glTransactions.txnDate), asc(schema.glTransactions.id));

  const posted = await db()
    .select({
      txn: schema.glTransactions,
      code: schema.costCodes,
      project: schema.projects,
    })
    .from(schema.glTransactions)
    .leftJoin(schema.costCodes, eq(schema.glTransactions.costCodeId, schema.costCodes.id))
    .leftJoin(schema.projects, eq(schema.glTransactions.projectId, schema.projects.id))
    .where(
      and(eq(schema.glTransactions.batchId, batchId), eq(schema.glTransactions.status, "posted")),
    )
    .orderBy(desc(schema.glTransactions.txnDate));

  const [postedAgg] = await db()
    .select({
      count: sql<number>`count(*)::int`,
      total: sql<string>`coalesce(sum(${schema.glTransactions.amount}), 0)`,
    })
    .from(schema.glTransactions)
    .where(
      and(eq(schema.glTransactions.batchId, batchId), eq(schema.glTransactions.status, "posted")),
    );

  const queueForClient = queue.map((t) => ({
    id: t.id,
    vendorRaw: t.vendorRaw,
    description: t.description,
    amount: t.amount,
    txnDate: t.txnDate,
    unitLabel: t.unitLabel,
    costCodeId: t.costCodeId,
    projectId: t.projectId,
    status: t.status as "staged" | "needs_review" | "excluded" | "posted",
    excludeReason: t.excludeReason,
  }));

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm">
          <Link
            href={`/properties/${propertyId}/gl`}
            className="text-gold-link hover:underline"
          >
            ← Import history
          </Link>
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold text-navy">{batch.fileName}</h1>
          <Badge variant={batch.status === "posted" ? "positive" : "pending"}>{batch.status}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {batch.sourceSystem ? `${batch.sourceSystem} · ` : ""}
          Imported {fmtDate(batch.createdAt)} · {batch.rowCount} rows · {batch.autoMappedCount}{" "}
          auto-mapped
        </p>
      </div>

      <PropertyNav propertyId={property.id} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base text-navy">Review queue</CardTitle>
        </CardHeader>
        <CardContent>
          <GlReviewQueue
            propertyId={property.id}
            batchId={batch.id}
            transactions={queueForClient}
            costCodes={costCodes}
            projects={projects}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-baseline justify-between">
          <CardTitle className="text-base text-navy">Posted transactions</CardTitle>
          <span className="text-sm text-muted-foreground">
            {postedAgg.count} posted · {money(postedAgg.total)}
          </span>
        </CardHeader>
        <CardContent>
          {posted.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Nothing posted from this import yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Vendor / description</TableHead>
                    <TableHead>Cost code</TableHead>
                    <TableHead>Project</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {posted.map(({ txn, code, project }) => (
                    <TableRow key={txn.id}>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {fmtDate(txn.txnDate)}
                      </TableCell>
                      <TableCell className="max-w-xs">
                        <div className="font-medium text-navy">{txn.vendorRaw ?? "—"}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {txn.description ?? ""}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{code ? code.code : "—"}</TableCell>
                      <TableCell className="text-xs">{project?.name ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(txn.amount)}</TableCell>
                      <TableCell className="text-right">
                        <UnpostButton transactionId={txn.id} />
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

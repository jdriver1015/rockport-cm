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
import { GlUpload } from "@/components/gl-upload";
import { PropertyNav } from "@/components/property-nav";
import { fmtDate, money } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function GlPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const propertyId = Number(id);
  if (!Number.isInteger(propertyId)) notFound();

  const property = await db().query.properties.findFirst({
    where: eq(schema.properties.id, propertyId),
  });
  if (!property) notFound();

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
        eq(schema.glTransactions.propertyId, propertyId),
        inArray(schema.glTransactions.status, ["staged", "needs_review", "excluded"]),
      ),
    )
    .orderBy(desc(schema.glTransactions.txnDate), asc(schema.glTransactions.id));

  const batches = await db()
    .select()
    .from(schema.importBatches)
    .where(eq(schema.importBatches.propertyId, propertyId))
    .orderBy(desc(schema.importBatches.createdAt));

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
      and(
        eq(schema.glTransactions.propertyId, propertyId),
        eq(schema.glTransactions.status, "posted"),
      ),
    )
    .orderBy(desc(schema.glTransactions.txnDate))
    .limit(100);

  const [postedAgg] = await db()
    .select({
      count: sql<number>`count(*)::int`,
      total: sql<string>`coalesce(sum(${schema.glTransactions.amount}), 0)`,
    })
    .from(schema.glTransactions)
    .where(
      and(
        eq(schema.glTransactions.propertyId, propertyId),
        eq(schema.glTransactions.status, "posted"),
      ),
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
        <h1 className="text-2xl font-semibold text-[#1b355d]">{property.name}</h1>
        <p className="text-sm text-muted-foreground">
          GL intake — drop an export, reconcile to cost codes, post to actuals
          {property.glUpdatedThru ? ` · GL updated thru ${fmtDate(property.glUpdatedThru)}` : ""}
        </p>
      </div>

      <PropertyNav propertyId={property.id} />

      <GlUpload propertyId={property.id} />

      {batches.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-[#1b355d]">Import history</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>File</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Uploaded</TableHead>
                  <TableHead className="text-right">Rows</TableHead>
                  <TableHead className="text-right">Auto-mapped</TableHead>
                  <TableHead className="text-right">Needs review</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batches.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="font-medium">{b.fileName}</TableCell>
                    <TableCell className="text-muted-foreground">{b.sourceSystem ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{fmtDate(b.createdAt)}</TableCell>
                    <TableCell className="text-right tabular-nums">{b.rowCount}</TableCell>
                    <TableCell className="text-right tabular-nums">{b.autoMappedCount}</TableCell>
                    <TableCell className="text-right tabular-nums">{b.needsReviewCount}</TableCell>
                    <TableCell>
                      <Badge variant={b.status === "posted" ? "secondary" : "outline"}>
                        {b.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base text-[#1b355d]">Review queue</CardTitle>
        </CardHeader>
        <CardContent>
          <GlReviewQueue
            propertyId={property.id}
            transactions={queueForClient}
            costCodes={costCodes}
            projects={projects}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-baseline justify-between">
          <CardTitle className="text-base text-[#1b355d]">Posted transactions</CardTitle>
          <span className="text-sm text-muted-foreground">
            {postedAgg.count} posted · {money(postedAgg.total)}
          </span>
        </CardHeader>
        <CardContent>
          {posted.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Nothing posted yet.
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
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {posted.map(({ txn, code, project }) => (
                    <TableRow key={txn.id}>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {fmtDate(txn.txnDate)}
                      </TableCell>
                      <TableCell className="max-w-xs">
                        <div className="font-medium text-[#1b355d]">{txn.vendorRaw ?? "—"}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {txn.description ?? ""}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {code ? `${code.code}` : "—"}
                      </TableCell>
                      <TableCell className="text-xs">{project?.name ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(txn.amount)}</TableCell>
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

import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DeleteBatchButton } from "@/components/delete-batch-button";
import { RestoreBatchButton } from "@/components/restore-batch-button";
import { GlAccountPicker, type AccountRow } from "@/components/gl-account-picker";
import { GlColumnMapper } from "@/components/gl-column-mapper";
import { GlReviewQueue } from "@/components/gl-review-queue";
import { PropertyNav } from "@/components/property-nav";
import { UnpostButton } from "@/components/unpost-button";
import { extractSheetPreview } from "@/lib/gl-import";
import { downloadStoredFile } from "@/lib/gl-import-pipeline";
import { fmtDate, money } from "@/lib/format";

export const dynamic = "force-dynamic";

const POSTED_PAGE_SIZE = 50;

export default async function BatchDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; batchId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id, batchId: bid } = await params;
  const sp = await searchParams;
  const propertyId = Number(id);
  const batchId = Number(bid);
  if (!Number.isInteger(propertyId) || !Number.isInteger(batchId)) notFound();

  const postedPageParam = Array.isArray(sp.postedPage) ? sp.postedPage[0] : sp.postedPage;
  const postedPage = Math.max(1, Number(postedPageParam) || 1);

  // Guards first (both independent), then the batch's data queries in parallel.
  const [property, batch] = await Promise.all([
    db().query.properties.findFirst({ where: eq(schema.properties.id, propertyId) }),
    db().query.importBatches.findFirst({ where: eq(schema.importBatches.id, batchId) }),
  ]);
  if (!property) notFound();
  if (!batch || batch.propertyId !== propertyId) notFound();

  // Unrecognized layout: show the manual column mapper against a preview of the
  // stored file.
  if (batch.status === "needs_mapping") {
    let sheets: { name: string; rows: string[][]; totalRows: number }[] = [];
    if (batch.storagePath) {
      try {
        sheets = extractSheetPreview(await downloadStoredFile(batch.storagePath), 18).sheets;
      } catch {
        sheets = [];
      }
    }
    return (
      <div className="space-y-6">
        <div>
          <p className="text-sm">
            <Link href={`/properties/${propertyId}/gl`} className="text-gold-link hover:underline">
              ← Import history
            </Link>
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold text-navy">{batch.fileName}</h1>
            <Badge variant="pending">map columns</Badge>
            <DeleteBatchButton propertyId={propertyId} batchId={batch.id} fileName={batch.fileName} />
          </div>
        </div>

        <PropertyNav propertyId={property.id} />

        <Card>
          <CardHeader>
            <CardTitle className="text-base text-navy">Map the columns</CardTitle>
          </CardHeader>
          <CardContent>
            <GlColumnMapper propertyId={propertyId} batchId={batch.id} sheets={sheets} />
          </CardContent>
        </Card>
      </div>
    );
  }

  // Grouped imports pause here until the user picks which GL account sections to
  // import — no transactions exist yet, so render the account picker instead of
  // the review queue.
  if (batch.status === "needs_accounts") {
    const accounts = (batch.accountSummary ?? []) as AccountRow[];
    return (
      <div className="space-y-6">
        <div>
          <p className="text-sm">
            <Link href={`/properties/${propertyId}/gl`} className="text-gold-link hover:underline">
              ← Import history
            </Link>
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold text-navy">{batch.fileName}</h1>
            <Badge variant="pending">select accounts</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {batch.sourceSystem ? `${batch.sourceSystem} · ` : ""}
            {accounts.length} account sections found
            {batch.storagePath && (
              <>
                {" · "}
                <a
                  href={`/api/properties/${propertyId}/gl/${batch.id}/file`}
                  className="text-gold-link hover:underline"
                >
                  Download original
                </a>
              </>
            )}
          </p>
        </div>

        <PropertyNav propertyId={property.id} />

        <Card>
          <CardHeader>
            <CardTitle className="text-base text-navy">Which accounts are construction?</CardTitle>
          </CardHeader>
          <CardContent>
            <GlAccountPicker propertyId={propertyId} batchId={batch.id} accounts={accounts} />
          </CardContent>
        </Card>
      </div>
    );
  }

  const [costCodes, projects, queue, posted, [postedAgg]] = await Promise.all([
    db()
      .select({ id: schema.costCodes.id, code: schema.costCodes.code, name: schema.costCodes.name })
      .from(schema.costCodes)
      .where(eq(schema.costCodes.active, true))
      .orderBy(asc(schema.costCodes.code)),
    db()
      .select({
        id: schema.projects.id,
        name: schema.projects.name,
        kind: schema.projects.kind,
        costCodeId: schema.projects.costCodeId,
      })
      .from(schema.projects)
      .where(
        and(eq(schema.projects.propertyId, propertyId), isNull(schema.projects.archivedAt)),
      )
      .orderBy(asc(schema.projects.name)),
    db()
      .select()
      .from(schema.glTransactions)
      .where(
        and(
          eq(schema.glTransactions.batchId, batchId),
          inArray(schema.glTransactions.status, ["staged", "needs_review", "excluded"]),
        ),
      )
      .orderBy(desc(schema.glTransactions.txnDate), asc(schema.glTransactions.id)),
    db()
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
      .orderBy(desc(schema.glTransactions.txnDate), asc(schema.glTransactions.id))
      .limit(POSTED_PAGE_SIZE)
      .offset((postedPage - 1) * POSTED_PAGE_SIZE),
    db()
      .select({
        count: sql<number>`count(*)::int`,
        total: sql<string>`coalesce(sum(${schema.glTransactions.amount}), 0)`,
      })
      .from(schema.glTransactions)
      .where(
        and(eq(schema.glTransactions.batchId, batchId), eq(schema.glTransactions.status, "posted")),
      ),
  ]);

  const postedTotalPages = Math.max(1, Math.ceil(postedAgg.count / POSTED_PAGE_SIZE));

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
          {batch.archivedAt && <Badge variant="secondary">Archived</Badge>}
          {batch.archivedAt ? (
            <RestoreBatchButton batchId={batch.id} />
          ) : (
            <DeleteBatchButton propertyId={propertyId} batchId={batch.id} fileName={batch.fileName} />
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          {batch.sourceSystem ? `${batch.sourceSystem} · ` : ""}
          Imported {fmtDate(batch.createdAt)} · {batch.rowCount} rows · {batch.autoMappedCount}{" "}
          auto-mapped
          {batch.storagePath && (
            <>
              {" · "}
              <a
                href={`/api/properties/${propertyId}/gl/${batch.id}/file`}
                className="text-gold-link hover:underline"
              >
                Download original
              </a>
            </>
          )}
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
          {postedTotalPages > 1 && (
            <div className="mt-3 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                Page {postedPage} of {postedTotalPages}
              </span>
              <div className="flex gap-2">
                {postedPage <= 1 ? (
                  <Button size="sm" variant="outline" disabled>
                    Previous
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    render={
                      <Link
                        href={`/properties/${propertyId}/gl/${batchId}?postedPage=${postedPage - 1}`}
                      />
                    }
                  >
                    Previous
                  </Button>
                )}
                {postedPage >= postedTotalPages ? (
                  <Button size="sm" variant="outline" disabled>
                    Next
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    render={
                      <Link
                        href={`/properties/${propertyId}/gl/${batchId}?postedPage=${postedPage + 1}`}
                      />
                    }
                  >
                    Next
                  </Button>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PropertyNav } from "@/components/property-nav";
import { RentRollParseRunner } from "@/components/rent-roll-parse-runner";
import { RentRollReview, type Floorplan, type RawSheet } from "@/components/rent-roll-review";
import {
  DeleteRentRollButton,
  RestoreRentRollButton,
  RetryParseButton,
} from "@/components/rent-roll-batch-actions";
import { fmtDate, num } from "@/lib/format";

export const dynamic = "force-dynamic";

const STATUS_BADGE: Record<string, { label: string; variant: "positive" | "pending" | "secondary" }> = {
  committed: { label: "committed", variant: "positive" },
  needs_review: { label: "review", variant: "pending" },
  parsing: { label: "parsing…", variant: "pending" },
  failed: { label: "failed", variant: "secondary" },
  uploaded: { label: "uploaded", variant: "pending" },
};

export default async function RentRollDetailPage({
  params,
}: {
  params: Promise<{ id: string; batchId: string }>;
}) {
  const { id, batchId: bid } = await params;
  const propertyId = Number(id);
  const batchId = Number(bid);
  if (!Number.isInteger(propertyId) || !Number.isInteger(batchId)) notFound();

  const [property, batch] = await Promise.all([
    db().query.properties.findFirst({ where: eq(schema.properties.id, propertyId) }),
    db().query.rentRollBatches.findFirst({ where: eq(schema.rentRollBatches.id, batchId) }),
  ]);
  if (!property) notFound();
  if (!batch || batch.propertyId !== propertyId) notFound();

  const badge = STATUS_BADGE[batch.status] ?? { label: batch.status, variant: "pending" as const };
  const meta = (batch.extractedMeta ?? {}) as {
    floorplans?: Floorplan[];
    rawSheet?: RawSheet | null;
    mapping?: {
      header_row: number;
      data_start_row: number;
      columns: Record<string, number | null | undefined>;
    } | null;
  };

  const header = (
    <div>
      <p className="text-sm">
        <Link
          href={`/properties/${propertyId}/rent-rolls`}
          className="text-gold-link hover:underline"
        >
          ← Rent roll snapshots
        </Link>
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold text-navy">{batch.fileName}</h1>
        <Badge variant={badge.variant}>{badge.label}</Badge>
        {batch.archivedAt && <Badge variant="secondary">Archived</Badge>}
        {batch.archivedAt ? (
          <RestoreRentRollButton batchId={batch.id} />
        ) : (
          <DeleteRentRollButton propertyId={propertyId} batchId={batch.id} fileName={batch.fileName} />
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        {batch.sourceSystem ? `${batch.sourceSystem} · ` : ""}
        {batch.fileKind ? `${batch.fileKind.toUpperCase()} · ` : ""}
        Uploaded {fmtDate(batch.createdAt)}
        {batch.asOfDate ? ` · as of ${fmtDate(batch.asOfDate)}` : ""}
        {batch.parseMethod ? ` · ${batch.parseMethod.replace("_", " ")}` : ""}
        {batch.storagePath && (
          <>
            {" · "}
            <a
              href={`/api/properties/${propertyId}/rent-rolls/${batch.id}/file`}
              className="text-gold-link hover:underline"
            >
              Download original
            </a>
          </>
        )}
      </p>
    </div>
  );

  // Parsing in progress — kick off / resume the parse, then reveal the review.
  if (batch.status === "parsing" || batch.status === "uploaded") {
    return (
      <div className="space-y-6">
        {header}
        <PropertyNav propertyId={property.id} />
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-navy">Parsing rent roll</CardTitle>
          </CardHeader>
          <CardContent>
            <RentRollParseRunner batchId={batch.id} />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (batch.status === "failed") {
    return (
      <div className="space-y-6">
        {header}
        <PropertyNav propertyId={property.id} />
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-navy">Parse failed</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-red-700 dark:text-red-400">
              {batch.errorMessage ?? "Could not parse this rent roll."}
            </p>
            <RetryParseButton batchId={batch.id} />
          </CardContent>
        </Card>
      </div>
    );
  }

  // needs_review or committed — load units and show the review sheet.
  const units = await db()
    .select()
    .from(schema.rentRollUnits)
    .where(eq(schema.rentRollUnits.batchId, batchId))
    .orderBy(asc(schema.rentRollUnits.sourceRow), asc(schema.rentRollUnits.id));

  return (
    <div className="space-y-6">
      {header}
      <PropertyNav propertyId={property.id} />
      <RentRollReview
        batchId={batch.id}
        committed={batch.status === "committed"}
        summary={{
          unitCount: batch.rowCount,
          occupancyPct: batch.occupancyPct != null ? Number(batch.occupancyPct) : null,
          totalMarketRent: num(batch.totalMarketRent),
          totalInPlaceRent: num(batch.totalInPlaceRent),
          lossToLease: num(batch.lossToLease),
          occupied: batch.occupiedCount,
        }}
        warnings={(batch.warnings as string[] | null) ?? []}
        confidenceScore={batch.confidenceScore}
        floorplans={meta.floorplans ?? []}
        units={units.map((u) => ({
          id: u.id,
          unitNumber: u.unitNumber,
          floorPlanCode: u.floorPlanCode,
          beds: u.beds,
          baths: u.baths,
          squareFeet: u.squareFeet,
          marketRent: u.marketRent,
          inPlaceRent: u.inPlaceRent,
          status: u.status,
          residentName: u.residentName,
          leaseStart: u.leaseStart,
          leaseEnd: u.leaseEnd,
          needsReview: u.needsReview,
          reviewNote: u.reviewNote,
        }))}
        rawSheet={meta.rawSheet ?? null}
        mapping={meta.mapping ?? null}
      />
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { InteriorWizard, type WizardBudgetGroup, type WizardUnit, type WizardVendor } from "@/components/interior-wizard";

export const dynamic = "force-dynamic";

export default async function NewInteriorProjectPage({
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

  const latestBatch = await db()
    .select({ id: schema.rentRollBatches.id, asOfDate: schema.rentRollBatches.asOfDate })
    .from(schema.rentRollBatches)
    .where(
      and(
        eq(schema.rentRollBatches.propertyId, propertyId),
        eq(schema.rentRollBatches.status, "committed"),
        isNull(schema.rentRollBatches.archivedAt),
      ),
    )
    .orderBy(desc(schema.rentRollBatches.asOfDate), desc(schema.rentRollBatches.createdAt))
    .limit(1);

  const units: WizardUnit[] = latestBatch[0]
    ? (
        await db()
          .select({
            unitNumber: schema.rentRollUnits.unitNumber,
            floorPlanCode: schema.rentRollUnits.floorPlanCode,
            beds: schema.rentRollUnits.beds,
            baths: schema.rentRollUnits.baths,
            squareFeet: schema.rentRollUnits.squareFeet,
          })
          .from(schema.rentRollUnits)
          .where(eq(schema.rentRollUnits.batchId, latestBatch[0].id))
          .orderBy(asc(schema.rentRollUnits.unitNumber))
      ).map((u) => ({
        unitNumber: u.unitNumber,
        floorplan: u.floorPlanCode,
        bedrooms: u.beds,
        baths: u.baths != null ? Number(u.baths) : null,
        sqft: u.squareFeet,
      }))
    : [];

  const groupRows = await db()
    .select()
    .from(schema.budgetGroups)
    .where(and(eq(schema.budgetGroups.propertyId, propertyId), isNull(schema.budgetGroups.archivedAt)))
    .orderBy(asc(schema.budgetGroups.sortOrder), asc(schema.budgetGroups.name));

  const groupIds = groupRows.map((g) => g.id);
  const allLines = groupIds.length
    ? await db()
        .select({
          id: schema.budgetGroupLines.id,
          budgetGroupId: schema.budgetGroupLines.budgetGroupId,
          costCodeId: schema.budgetGroupLines.costCodeId,
          pricingMethod: schema.budgetGroupLines.pricingMethod,
          unitPrice: schema.budgetGroupLines.unitPrice,
          defaultQuantity: schema.budgetGroupLines.defaultQuantity,
          notes: schema.budgetGroupLines.notes,
          sortOrder: schema.budgetGroupLines.sortOrder,
        })
        .from(schema.budgetGroupLines)
        .where(inArray(schema.budgetGroupLines.budgetGroupId, groupIds))
        .orderBy(asc(schema.budgetGroupLines.sortOrder), asc(schema.budgetGroupLines.id))
    : [];

  const codeIds = [...new Set(allLines.map((l) => l.costCodeId))];
  const costCodes = codeIds.length
    ? await db()
        .select({ id: schema.costCodes.id, name: schema.costCodes.name })
        .from(schema.costCodes)
        .where(inArray(schema.costCodes.id, codeIds))
    : [];
  const codeNameById = new Map(costCodes.map((c) => [c.id, c.name]));

  const groups: WizardBudgetGroup[] = groupRows.map((g) => ({
    id: g.id,
    name: g.name,
    lines: allLines
      .filter((ln) => ln.budgetGroupId === g.id)
      .map((ln) => ({
        id: ln.id,
        costCodeId: ln.costCodeId,
        costCodeName: codeNameById.get(ln.costCodeId) ?? `Code #${ln.costCodeId}`,
        category: null,
        pricingMethod: ln.pricingMethod as WizardBudgetGroup["lines"][number]["pricingMethod"],
        unitPrice: Number(ln.unitPrice),
        defaultQuantity: ln.defaultQuantity != null ? Number(ln.defaultQuantity) : null,
        notes: ln.notes,
      })),
  }));

  const vendors: WizardVendor[] = await db()
    .select({ id: schema.vendors.id, name: schema.vendors.name, trade: schema.vendors.trade })
    .from(schema.vendors)
    .where(eq(schema.vendors.active, true))
    .orderBy(asc(schema.vendors.name));

  const missingRentRoll = units.length === 0;
  const missingGroups = groups.length === 0;

  if (missingRentRoll || missingGroups) {
    return (
      <div className="mx-auto max-w-xl">
        <Card>
          <CardHeader>
            <CardTitle className="text-navy">New interior project — {property.name}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            {missingRentRoll && (
              <p>
                This property has no committed rent roll, so there are no units to choose from.{" "}
                <Link href={`/properties/${slug}/rent-rolls`} className="text-link hover:underline">
                  Import a rent roll
                </Link>{" "}
                first.
              </p>
            )}
            {missingGroups && (
              <p>
                No budget groups yet. Open{" "}
                <Link href={`/properties/${slug}/interiors`} className="text-link hover:underline">
                  Interiors → Manage Budget Groups
                </Link>{" "}
                to create one.
              </p>
            )}
            <Button render={<Link href={`/properties/${slug}/interiors`} />} variant="outline" nativeButton={false}>
              Back to Interiors
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <InteriorWizard
        propertyId={propertyId}
        propertySlug={property.slug}
        units={units}
        groups={groups}
        vendors={vendors}
      />
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { InteriorWizard, type WizardScopeGroup, type WizardUnit, type WizardVendor } from "@/components/interior-wizard";

export const dynamic = "force-dynamic";

export default async function NewInteriorProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const propertyId = Number(id);
  if (!Number.isInteger(propertyId)) notFound();

  const property = await db().query.properties.findFirst({
    where: eq(schema.properties.id, propertyId),
  });
  if (!property) notFound();

  // Latest committed rent roll drives the unit picker.
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
    .from(schema.scopeGroups)
    .where(and(eq(schema.scopeGroups.propertyId, propertyId), isNull(schema.scopeGroups.archivedAt)))
    .orderBy(asc(schema.scopeGroups.sortOrder), asc(schema.scopeGroups.name));

  const groupIds = groupRows.map((g) => g.id);
  const allItems = groupIds.length
    ? await db()
        .select()
        .from(schema.scopeGroupItems)
        .where(
          and(
            inArray(schema.scopeGroupItems.scopeGroupId, groupIds),
            eq(schema.scopeGroupItems.active, true),
          ),
        )
        .orderBy(asc(schema.scopeGroupItems.sortOrder), asc(schema.scopeGroupItems.id))
    : [];

  const groups: WizardScopeGroup[] = groupRows.map((g) => ({
    id: g.id,
    name: g.name,
    items: allItems
      .filter((it) => it.scopeGroupId === g.id)
      .map((it) => ({
        id: it.id,
        name: it.name,
        category: it.category,
        pricingMethod: it.pricingMethod,
        unitPrice: Number(it.unitPrice),
        defaultQuantity: it.defaultQuantity != null ? Number(it.defaultQuantity) : null,
        quantityFormula: it.quantityFormula,
        costCodeId: it.costCodeId,
        materialAssumptions: it.materialAssumptions,
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
                <Link href={`/properties/${propertyId}/rent-rolls`} className="text-gold-link hover:underline">
                  Import a rent roll
                </Link>{" "}
                first.
              </p>
            )}
            {missingGroups && (
              <p>
                No scope groups yet. Open{" "}
                <Link href={`/properties/${propertyId}/interiors`} className="text-gold-link hover:underline">
                  Interiors → Manage Scope Groups
                </Link>{" "}
                to create one.
              </p>
            )}
            <Button render={<Link href={`/properties/${propertyId}/interiors`} />} variant="outline" nativeButton={false}>
              Back to Interiors
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <InteriorWizard propertyId={propertyId} units={units} groups={groups} vendors={vendors} />
    </div>
  );
}

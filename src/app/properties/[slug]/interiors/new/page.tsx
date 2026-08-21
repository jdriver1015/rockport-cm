import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { readScheduleDefaults } from "@/lib/interior-defaults";
import { suggestSchedule, todayInBusinessZone } from "@/lib/schedule-defaults";
import { listTriggerSteps } from "@/lib/renovation-triggers-store";
import { projectSlug } from "@/lib/slug";
import { phaseLabel } from "@/lib/stages";
import {
  InteriorWizard,
  type WizardAllocation,
  type WizardBudgetGroup,
  type WizardPin,
  type WizardTakenUnit,
  type WizardUnit,
  type WizardUnitGroup,
  type WizardVendor,
} from "@/components/interior-wizard";
import { computeInteriorBudgetFor } from "@/lib/interior-budget";

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

  // The interior plan supplies two things the wizard needs: the overridden amounts
  // this unit's group carries (so a created project's budget matches its pivot
  // cell), and how much of each tier is still unstarted.
  const interior = await computeInteriorBudgetFor(propertyId);
  const schedule = await readScheduleDefaults();
  // Computed here, not in the wizard: `new Date()` inside a client component's
  // state initializer runs once on the server (UTC) and again in the browser
  // (local), which shifted every suggested date by a day after ~7pm Central and
  // mismatched on hydration. One anchored answer, rendered once.
  const suggestedDates = suggestSchedule(schedule, todayInBusinessZone());
  // The pre-walk rule, shown as a checklist beside the type choice. Not fatal if
  // it fails: the wizard's job is creating the project, and the checklist is a
  // reminder alongside it.
  const triggerSteps = await listTriggerSteps(propertyId).catch((err) => {
    console.error("interior wizard: trigger rule failed to load", err);
    return [];
  });

  // Units that already have an interior project. A unit cannot be turned twice
  // in one cycle, and the budget would double-count it — so these are offered
  // as unavailable, with a link to the project that claimed them, rather than
  // hidden. Hiding them raises "where is 006?" and gives no answer.
  const takenRows = await db()
    .select({
      unitNumber: schema.units.unitNumber,
      projectId: schema.projects.id,
      projectName: schema.projects.name,
      phase: schema.projects.phase,
    })
    .from(schema.projects)
    .innerJoin(schema.units, eq(schema.units.id, schema.projects.unitId))
    .where(
      and(
        eq(schema.projects.propertyId, propertyId),
        eq(schema.projects.kind, "unit"),
        isNull(schema.projects.archivedAt),
      ),
    );

  const takenUnits: WizardTakenUnit[] = takenRows.map((r) => ({
    unitNumber: r.unitNumber,
    phaseLabel: phaseLabel(r.phase),
    href: `/properties/${slug}/projects/${projectSlug({ id: r.projectId, name: r.projectName })}`,
  }));
  const unitGroups: WizardUnitGroup[] = interior.unitGroups.map((g) => ({
    id: g.id,
    name: g.name,
    bedrooms: g.bedrooms,
    unitCount: g.unitCount,
    floorPlanCodes: g.floorPlanCodes,
  }));
  const pins: WizardPin[] = interior.cells
    .filter((c) => c.overridden)
    .map((c) => ({
      unitGroupId: c.unitGroupId,
      tierId: c.tierId,
      costCodeId: c.costCodeId,
      amount: c.amount,
    }));
  const allocations: WizardAllocation[] = interior.columns.map((c) => ({
    unitGroupId: c.unitGroupId,
    tierId: c.tierId,
    plannedUnits: c.plannedUnits,
    actualUnits: c.actualUnits,
  }));

  const missingRentRoll = units.length === 0;
  const missingGroups = groups.length === 0;

  if (missingRentRoll || missingGroups) {
    return (
      <div className="mx-auto max-w-xl">
        <Card>
          <CardHeader>
            <CardTitle className="text-navy">New unit upgrade — {property.name}</CardTitle>
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
                No renovation types yet. Open{" "}
                <Link href={`/properties/${slug}/interiors`} className="text-link hover:underline">
                  Unit Upgrades → Manage renovation types
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
        unitGroups={unitGroups}
        pins={pins}
        allocations={allocations}
        schedule={schedule}
        suggestedDates={suggestedDates}
        takenUnits={takenUnits}
        triggerSteps={triggerSteps}
      />
    </div>
  );
}

import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { PropertyHeader } from "@/components/property-header";
import { PropertyNav } from "@/components/property-nav";
import { BudgetView } from "@/components/budget-view";
import { AddBudgetLineDialog } from "@/components/add-budget-line-dialog";
import { BudgetViewSwitch } from "@/components/budget-view-switch";
import { parseBudgetView } from "@/lib/budget-views";
import { InteriorBudgetPivot } from "@/components/interior-budget-pivot";
import { InteriorBudgetToolbar } from "@/components/interior-budget-toolbar";
import { buttonVariants } from "@/components/ui/button";
import { FileSpreadsheetIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { num } from "@/lib/format";
import { computePropertyBudget } from "@/lib/property-budget";
import { BudgetImportDialog } from "@/components/budget-import-dialog";
import { BudgetLockControl } from "@/components/budget-lock-control";
import { fetchBudgetLockState, fetchBudgetLockEvents } from "@/lib/property-budget-lock";

export const dynamic = "force-dynamic";

export default async function BudgetPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { slug } = await params;
  const view = parseBudgetView((await searchParams).view);

  const property = await db().query.properties.findFirst({
    where: eq(schema.properties.slug, slug),
  });
  if (!property) notFound();
  const propertyId = property.id;

  // A property's chart of accounts is fixed at creation. Every budget line, cost
  // code and GL transaction hangs off it, so switching it would invalidate all of
  // them — there is deliberately no way to change it here.

  // Kicked off alongside the budget computation below rather than after it —
  // neither lock query depends on anything computePropertyBudget returns.
  const lockPromise = Promise.all([fetchBudgetLockState(propertyId), fetchBudgetLockEvents(propertyId)]);

  const {
    budgetDivisions,
    codes,
    categoryOptions,
    costCodeOptions,
    budgetedCostCodeIds,
    interior,
    interiorNote,
    rentRoll,
    avgTradeOutByTier,
    availableFloorplans,
    existingColumns,
    availableTiers,
  } = await computePropertyBudget(propertyId, property.chartOfAccountsId);

  const [lockState, lockEvents] = await lockPromise;

  // Exterior view = everything that isn't unit interiors. Their exterior workbook
  // includes clubhouse, pool, amenities, soft costs and contingency, so this is
  // the whole non-interior budget, not just division 'exterior'.
  const visibleDivisions =
    view === "exterior" ? budgetDivisions.filter((d) => d.key !== "interiors") : budgetDivisions;

  return (
    <div className="space-y-6">
      <PropertyHeader property={property} />

      <PropertyNav slug={property.slug} />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <BudgetViewSwitch value={view} />
          <div className="flex items-center gap-2">
            {/* Interior pricing has its own toolbar and isn't covered by this
                lock, so the control only makes sense next to the views it
                actually affects. */}
            {view !== "interior" && (
              <BudgetLockControl
                propertyId={property.id}
                locked={lockState.locked}
                lockedByName={lockState.lockedByName}
                lockedAt={lockState.lockedAt ? lockState.lockedAt.toISOString() : null}
                events={lockEvents}
              />
            )}
            {/* A link, not a button with an onClick: the route streams a
                workbook, so letting the browser download it is the whole
                behaviour. Always the full budget — both sheets — regardless
                of which view tab is open, since Exterior/Interior are ways of
                looking at one budget, not two different ones to export. */}
            <a
              href={`/api/properties/${property.id}/budget/export`}
              className={cn(buttonVariants({ size: "sm", variant: "outline" }))}
            >
              <FileSpreadsheetIcon className="size-3.5" />
              Download budget
            </a>
            {/* Always available, like Download — it replaces the non-interior
                budget regardless of which view tab happens to be open. */}
            <BudgetImportDialog
              mode="overwrite"
              propertyId={property.id}
              chartOfAccountsId={property.chartOfAccountsId}
              disabled={lockState.locked}
            />
            {view === "interior" ? (
              <InteriorBudgetToolbar
                propertyId={property.id}
                propertySlug={property.slug}
                floorplans={availableFloorplans}
                tiers={availableTiers}
                existingColumns={existingColumns}
              />
            ) : (
              <AddBudgetLineDialog
                propertyId={property.id}
                categories={categoryOptions}
                costCodes={costCodeOptions}
                budgetedCostCodeIds={budgetedCostCodeIds}
                disabled={lockState.locked}
              />
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {view === "interior" ? (
            <InteriorBudgetPivot
              propertyId={property.id}
              unitGroups={interior.unitGroups.map((g) => ({
                id: g.id,
                name: g.name,
                avgSqft: g.avgSqft,
                unitCount: g.unitCount,
                countOverridden: g.countOverridden,
                sqftOverridden: g.sqftOverridden,
              }))}
              tiers={interior.tiers.map((t) => {
                const at = availableTiers.find((a) => a.id === t.id);
                return { id: t.id, name: t.name, targetTradeOut: at?.targetTradeOut ? num(at.targetTradeOut) : null };
              })}
              availableTiers={availableTiers.map((t) => ({ id: t.id, name: t.name }))}
              avgTradeOutByTier={Object.fromEntries(avgTradeOutByTier)}
              rows={interior.rows.map((r) => ({
                costCodeId: r.costCodeId,
                code: r.code,
                label: r.label,
                categoryName: r.categoryName,
              }))}
              cells={interior.cells.map((c) => ({
                unitGroupId: c.unitGroupId,
                tierId: c.tierId,
                costCodeId: c.costCodeId,
                amount: c.amount,
                quantity: c.quantity,
                pricingMethod: c.pricingMethod,
                tierUnitPrice: c.tierUnitPrice,
                overridden: c.overridden,
                overrideNote: c.overrideNote,
                overridePricingMethod: c.overridePricingMethod,
                overrideUnitPrice: c.overrideUnitPrice,
                note: c.note,
              }))}
              columns={interior.columns.map((c) => ({
                unitGroupId: c.unitGroupId,
                tierId: c.tierId,
                scopeTotal: c.scopeTotal,
                cm: c.cm,
                contingency: c.contingency,
                perUnitTotal: c.perUnitTotal,
                plannedUnits: c.plannedUnits,
                totalCost: c.totalCost,
                actualUnits: c.actualUnits,
              }))}
              total={interior.total}
              uplift={interior.settings}
              interiorCodes={codes
                .filter((c) => c.isInterior)
                .map((c) => ({ id: c.id, code: c.code, name: c.name }))}
              unmappedFloorplans={interior.unmappedFloorplans}
              unattributedProjects={interior.unattributedProjects}
              propertySlug={property.slug}
              rentRoll={rentRoll}
              availableFloorplans={availableFloorplans}
            />
          ) : (
            <>
              {view === "consolidated" && interiorNote && (
                <p className="text-[11px] text-ink-500">{interiorNote}</p>
              )}
              <BudgetView
                propertyId={property.id}
                propertySlug={property.slug}
                divisions={visibleDivisions}
                locked={lockState.locked}
              />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { Pencil, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  WizardExistingColumn,
  WizardFloorplan,
  WizardTier,
} from "@/components/add-unit-renovation-wizard";

const AddUnitRenovationWizard = dynamic(() =>
  import("@/components/add-unit-renovation-wizard").then((m) => m.AddUnitRenovationWizard),
);

export type InteriorToolbarProps = {
  propertyId: number;
  propertySlug: string;
  floorplans: WizardFloorplan[];
  tiers: WizardTier[];
  existingColumns: WizardExistingColumn[];
};

/**
 * The Interior view's two actions.
 *
 * Editing what a type costs is a link, not a dialog: a renovation type now
 * carries scope and specs as well as pricing, which is more than a popup over
 * the pivot can hold, and the pivot is property-wide so there is no single type
 * to open anyway. Planning units into a type stays here — that IS budgeting.
 */
export function InteriorBudgetToolbar(props: InteriorToolbarProps) {
  const [wizardOpen, setWizardOpen] = useState(false);

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        nativeButton={false}
        render={<Link href={`/properties/${props.propertySlug}/interiors/types`} />}
      >
        <SlidersHorizontal className="size-3.5" />
        Renovation types
      </Button>
      <Button size="sm" onClick={() => setWizardOpen(true)}>
        <Pencil className="size-3.5" />
        Plan units
      </Button>

      <AddUnitRenovationWizard
        propertyId={props.propertyId}
        floorplans={props.floorplans}
        tiers={props.tiers}
        existingColumns={props.existingColumns}
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
      />
    </div>
  );
}

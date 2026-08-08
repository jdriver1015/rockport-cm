"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Pencil, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  WizardExistingColumn,
  WizardFloorplan,
  WizardTier,
} from "@/components/add-unit-renovation-wizard";
import type {
  EditorCodeChoice,
  EditorTier,
} from "@/components/renovation-type-editor";

const AddUnitRenovationWizard = dynamic(() =>
  import("@/components/add-unit-renovation-wizard").then((m) => m.AddUnitRenovationWizard),
);
const RenovationTypeEditor = dynamic(() =>
  import("@/components/renovation-type-editor").then((m) => m.RenovationTypeEditor),
);

export type InteriorToolbarProps = {
  propertyId: number;
  floorplans: WizardFloorplan[];
  tiers: WizardTier[];
  existingColumns: WizardExistingColumn[];
  editorTiers: EditorTier[];
  cmPct: number;
  contingencyPct: number;
  cmCostCodeId: number | null;
  contingencyCostCodeId: number | null;
  interiorCodes: EditorCodeChoice[];
};

/**
 * The Interior view's two actions: set what a renovation type costs by default,
 * and put units of a floorplan into one.
 */
export function InteriorBudgetToolbar(props: InteriorToolbarProps) {
  const [editorOpen, setEditorOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="outline" onClick={() => setEditorOpen(true)}>
        <SlidersHorizontal className="size-3.5" />
        Edit renovation type
      </Button>
      <Button size="sm" onClick={() => setWizardOpen(true)}>
        <Pencil className="size-3.5" />
        Edit renovation groups
      </Button>

      <RenovationTypeEditor
        propertyId={props.propertyId}
        tiers={props.editorTiers}
        cmPct={props.cmPct}
        contingencyPct={props.contingencyPct}
        cmCostCodeId={props.cmCostCodeId}
        contingencyCostCodeId={props.contingencyCostCodeId}
        interiorCodes={props.interiorCodes}
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
      />
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

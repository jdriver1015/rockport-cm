"use client";

import { useState } from "react";
import { Plus, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AddUnitRenovationWizard,
  type WizardFloorplan,
  type WizardTier,
} from "@/components/add-unit-renovation-wizard";
import {
  RenovationTypeEditor,
  type EditorCodeChoice,
  type EditorTier,
} from "@/components/renovation-type-editor";

export type InteriorToolbarProps = {
  propertyId: number;
  floorplans: WizardFloorplan[];
  tiers: WizardTier[];
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
        <Plus className="size-3.5" />
        Add units
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
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
      />
    </div>
  );
}

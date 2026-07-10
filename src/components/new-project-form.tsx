"use client";

import { useState } from "react";
import { createProject } from "@/lib/actions/projects";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type CostCode = { id: number; code: string; name: string };

export function NewProjectForm({
  propertyId,
  costCodes,
}: {
  propertyId: number;
  costCodes: CostCode[];
}) {
  const [kind, setKind] = useState<"common" | "unit">("common");

  return (
    <form action={createProject} className="space-y-4">
      <input type="hidden" name="propertyId" value={propertyId} />
      <input type="hidden" name="kind" value={kind} />

      <div className="space-y-1.5">
        <Label>Project type</Label>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              { key: "common", label: "Common area / amenity", hint: "Coded to one UW line item" },
              { key: "unit", label: "Interior unit turn", hint: "Spends across 4000-series codes" },
            ] as const
          ).map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setKind(opt.key)}
              className={cn(
                "rounded-md border p-3 text-left text-sm transition-colors",
                kind === opt.key
                  ? "border-[#1b355d] bg-[#e8edf2]"
                  : "border-input hover:bg-muted/50",
              )}
            >
              <span className="block font-medium text-[#1b355d]">{opt.label}</span>
              <span className="text-xs text-muted-foreground">{opt.hint}</span>
            </button>
          ))}
        </div>
      </div>

      {kind === "common" ? (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="costCodeId">UW line item (cost code)</Label>
            <select
              id="costCodeId"
              name="costCodeId"
              required
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              defaultValue=""
            >
              <option value="" disabled>
                Select a cost code…
              </option>
              {costCodes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="name">Project name</Label>
            <Input id="name" name="name" placeholder="Dog Park Fence (defaults to code name)" />
          </div>
        </>
      ) : (
        <div className="space-y-1.5">
          <Label htmlFor="unitNumber">Unit number</Label>
          <Input id="unitNumber" name="unitNumber" required placeholder="614" />
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="budgetAmount">Project budget ($)</Label>
          <Input
            id="budgetAmount"
            name="budgetAmount"
            type="number"
            min="0"
            step="0.01"
            placeholder={kind === "unit" ? "12006" : "25000"}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="startDate">Planned start</Label>
          <Input id="startDate" name="startDate" type="date" />
        </div>
      </div>

      <div className="flex justify-end pt-2">
        <Button type="submit">Create project</Button>
      </div>
    </form>
  );
}

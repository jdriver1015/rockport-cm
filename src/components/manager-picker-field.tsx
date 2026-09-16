"use client";

import { Label } from "@/components/ui/label";
import type { ManagerOption } from "@/lib/project-managers";

/**
 * "Who is running this" — offered once at creation, shared by every wizard
 * that creates a project, the same way TargetPhasingStep is. Optional: leaving
 * it on Unassigned is a real choice, matching projects.managerId's own
 * nullability, and ProjectManagerCell on the board can always name someone
 * later.
 */
export function ManagerPickerField({
  value,
  onChange,
  roster,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  roster: ManagerOption[];
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor="pm-manager">Project manager</Label>
      <select
        id="pm-manager"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        disabled={roster.length === 0}
        className="h-9 w-full rounded-md border border-input bg-transparent px-2.5 text-[13px] outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <option value="">Unassigned</option>
        {roster.map((person) => (
          <option key={person.id} value={person.id}>
            {person.name}
          </option>
        ))}
      </select>
      <p className="text-[11.5px] text-muted-foreground">
        {roster.length === 0
          ? "Nobody on the roster yet."
          : "Optional — assign or change this anytime from the property board."}
      </p>
    </div>
  );
}

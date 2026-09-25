"use client";

import { Label } from "@/components/ui/label";
import type { ManagerOption } from "@/lib/project-managers";

/**
 * "Who is running this" — required once at creation, shared by every wizard
 * that creates a project, the same way TargetPhasingStep is. A project with
 * nobody named is a project nobody chases, so unlike the board's own picker
 * (ProjectManagerCell, which allows Unassigned for a project that already
 * exists), this one has to land on a real person before the wizard will
 * create anything.
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
        <option value="" disabled>
          {roster.length === 0 ? "Nobody on the roster yet" : "Select a manager…"}
        </option>
        {roster.map((person) => (
          <option key={person.id} value={person.id}>
            {person.name}
          </option>
        ))}
      </select>
      <p className="text-[11.5px] text-muted-foreground">
        {roster.length === 0
          ? "Nobody on the roster yet."
          : "Required — you can reassign it anytime from the property board."}
      </p>
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createProject } from "@/lib/actions/projects";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Start a common-area project.
 *
 * A name and nothing else. The cost code, the budget and the dates all live on
 * the detail screen, where there is room to see what you are choosing between —
 * and asking for them here meant standing at a form deciding a budget for
 * something that does not exist yet.
 *
 * Interior turns are not created here. They come from the unit upgrade wizard,
 * which builds their scope and budget from a renovation template; an interior
 * project made by hand would arrive with neither.
 */
export function NewProjectForm({
  propertyId,
  propertySlug,
}: {
  propertyId: number;
  propertySlug: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await createProject(new FormData(e.currentTarget));
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      router.push(`/properties/${propertySlug}/projects/${result.slug}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create project");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <input type="hidden" name="propertyId" value={propertyId} />
      <input type="hidden" name="kind" value="common" />

      <div className="space-y-1.5">
        <Label htmlFor="name">Project name</Label>
        <Input id="name" name="name" required autoFocus placeholder="Dog Park Fence" />
        <p className="text-[12px] text-muted-foreground">
          Cost code, budget and dates are set on the project itself.
        </p>
      </div>

      <div className="flex justify-end pt-2">
        <Button type="submit" disabled={busy}>
          {busy ? "Creating…" : "Create project"}
        </Button>
      </div>
    </form>
  );
}

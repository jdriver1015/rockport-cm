"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createProperty } from "@/lib/actions/properties";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function NewPropertyForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await createProperty(new FormData(e.currentTarget));
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      router.push(`/properties/${result.propertyId}/budget`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create property");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="name">Property name</Label>
        <Input id="name" name="name" required placeholder="Retreat at Westpark" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="entity">Entity</Label>
        <Input id="entity" name="entity" placeholder="Retreat at Westpark, LLC" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="city">City</Label>
          <Input id="city" name="city" placeholder="Houston" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="state">State</Label>
          <Input id="state" name="state" placeholder="TX" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="unitCount">Unit count</Label>
          <Input id="unitCount" name="unitCount" type="number" min="1" placeholder="156" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pmSystem">PM system</Label>
          <Input id="pmSystem" name="pmSystem" placeholder="BH / Yardi" />
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="submit" disabled={busy}>
          {busy ? "Creating…" : "Create property"}
        </Button>
      </div>
    </form>
  );
}

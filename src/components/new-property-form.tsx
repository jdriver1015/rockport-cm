"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createProperty } from "@/lib/actions/properties";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type ChartOption = { id: number; name: string; isDefault: boolean };

export function NewPropertyForm({ charts }: { charts: ChartOption[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const defaultChartId = charts.find((c) => c.isDefault)?.id ?? charts[0]?.id;

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
      <div className="space-y-1.5">
        <Label htmlFor="chartOfAccountsId">Chart of accounts</Label>
        <select
          id="chartOfAccountsId"
          name="chartOfAccountsId"
          required
          defaultValue={defaultChartId ?? ""}
          className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          {charts.length === 0 && (
            <option value="" disabled>
              No charts — create one in Settings first
            </option>
          )}
          {charts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.isDefault ? " (default)" : ""}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          Budget lines and GL codes use this chart. It locks once GL activity is imported.
        </p>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="submit" disabled={busy}>
          {busy ? "Creating…" : "Create property"}
        </Button>
      </div>
    </form>
  );
}

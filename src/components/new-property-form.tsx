"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createProperty } from "@/lib/actions/properties";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type ChartOption = { id: number; name: string; isDefault: boolean };

export type SeedTemplateOption = {
  id: number;
  name: string;
  description: string | null;
  seedByDefault: boolean;
  lineCount: number;
};

export function NewPropertyForm({
  charts,
  seedTemplates,
}: {
  charts: ChartOption[];
  seedTemplates: SeedTemplateOption[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const defaultChartId = charts.find((c) => c.isDefault)?.id ?? charts[0]?.id;
  // Pre-checked from the portfolio defaults, but every active type is offered:
  // the standard set is a starting point, not a restriction.
  const [checked, setChecked] = useState<Set<number>>(
    () => new Set(seedTemplates.filter((t) => t.seedByDefault).map((t) => t.id)),
  );

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await createProperty(new FormData(e.currentTarget));
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      // Seeding is best-effort, so say what actually landed rather than
      // letting a half-copied set of types read as the whole standard scope.
      const seeded = result.seededTypes > 0
        ? `${result.seededTypes} renovation type${result.seededTypes === 1 ? "" : "s"} seeded`
        : "Property created";
      if (result.notes.length > 0) {
        toast.warning(seeded, { description: result.notes.join(" · "), duration: 12000 });
      } else {
        toast.success(seeded);
      }
      router.push(`/properties/${result.slug}/budget`);
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
      <div className="space-y-2 border-t border-border pt-4">
        <div>
          <Label>Renovation types to start with</Label>
          <p className="text-xs text-muted-foreground">
            Copies each type&apos;s priced scope into this property. Pricing can be edited per
            property afterwards, and more types can be added at any time.
          </p>
        </div>
        {seedTemplates.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No portfolio renovation types yet — add them in Settings and future properties will
            start from them.
          </p>
        ) : (
          <div className="divide-y divide-hairline rounded-card border border-border">
            {seedTemplates.map((t) => (
              <label key={t.id} className="flex cursor-pointer items-start gap-2.5 px-3 py-2">
                <input
                  type="checkbox"
                  name="seedTemplateIds"
                  value={t.id}
                  checked={checked.has(t.id)}
                  onChange={(e) =>
                    setChecked((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(t.id);
                      else next.delete(t.id);
                      return next;
                    })
                  }
                  className="mt-0.5 size-3.5 accent-navy"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="text-[13px] font-medium text-navy">{t.name}</span>
                    <span className="text-[11px] text-muted-foreground tabular-nums">
                      {t.lineCount} line{t.lineCount === 1 ? "" : "s"}
                    </span>
                  </span>
                  {t.description && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {t.description}
                    </span>
                  )}
                </span>
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="submit" disabled={busy}>
          {busy ? "Creating…" : "Create property"}
        </Button>
      </div>
    </form>
  );
}

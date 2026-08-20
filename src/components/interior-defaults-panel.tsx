"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateInteriorDefaults } from "@/lib/actions/interior-defaults";
import type { InteriorDefaults } from "@/lib/interior-defaults";

/**
 * Portfolio uplift defaults — what a new property's Interior budget opens with.
 *
 * Cost codes are entered as CODES, not picked from a list: these defaults have
 * to hold for a property whose chart of accounts doesn't exist yet, so there is
 * no single chart to offer a picker over. Resolution happens at creation, and
 * anything that fails to resolve is reported there.
 */
export function InteriorDefaultsPanel({ defaults }: { defaults: InteriorDefaults }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [cmOn, setCmOn] = useState(defaults.cmEnabled);
  const [contOn, setContOn] = useState(defaults.contingencyEnabled);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const res = await updateInteriorDefaults({
        cmEnabled: cmOn,
        contingencyEnabled: contOn,
        cmSupervisionPct: Number(fd.get("cmPct")),
        contingencyPct: Number(fd.get("contingencyPct")),
        cmCostCodeRef: String(fd.get("cmCostCodeRef") ?? ""),
        contingencyCostCodeRef: String(fd.get("contingencyCostCodeRef") ?? ""),
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Defaults saved — applies to properties created from here on");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-baseline justify-between gap-3">
        <CardTitle className="text-base text-navy">Uplifts on new properties</CardTitle>
        <span className="text-sm text-muted-foreground">
          Existing properties keep their own — change those on Budget → Interior.
        </span>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="grid gap-3 sm:grid-cols-2">
            <DefaultUpliftFields
              idPrefix="cm"
              label="CM / supervision"
              enabled={cmOn}
              onEnabledChange={setCmOn}
              pct={defaults.cmPct}
              pctName="cmPct"
              refName="cmCostCodeRef"
              codeRef={defaults.cmCostCodeRef}
            />
            <DefaultUpliftFields
              idPrefix="cont"
              label="Contingency"
              enabled={contOn}
              onEnabledChange={setContOn}
              pct={defaults.contingencyPct}
              pctName="contingencyPct"
              refName="contingencyCostCodeRef"
              codeRef={defaults.contingencyCostCodeRef}
            />
          </div>
          <p className="text-[11px] text-ink-500">
            Cost codes are entered as codes rather than picked from a list, because a new
            property&apos;s chart of accounts isn&apos;t chosen yet. A code with no match in the
            chart picked at creation is reported there.
          </p>
          <div className="flex justify-end">
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save defaults"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function DefaultUpliftFields({
  idPrefix, label, enabled, onEnabledChange, pct, pctName, refName, codeRef,
}: {
  idPrefix: string;
  label: string;
  enabled: boolean;
  onEnabledChange: (on: boolean) => void;
  pct: number;
  pctName: string;
  refName: string;
  codeRef: string | null;
}) {
  return (
    <div className="space-y-2.5 rounded-card border border-border p-3">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onEnabledChange(e.target.checked)}
          className="size-3.5 accent-navy"
        />
        <span className="text-[13px] font-medium text-navy">{label}</span>
      </label>
      <div className="grid grid-cols-[5.5rem_1fr] gap-2.5">
        <div className="space-y-1.5">
          <Label htmlFor={`def-${idPrefix}-pct`} className="text-[11px]">Rate (%)</Label>
          <Input
            id={`def-${idPrefix}-pct`}
            name={pctName}
            type="number"
            min="0"
            max="100"
            step="0.001"
            defaultValue={pct}
            disabled={!enabled}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`def-${idPrefix}-ref`} className="text-[11px]">Posts to (cost code)</Label>
          <Input
            id={`def-${idPrefix}-ref`}
            name={refName}
            defaultValue={codeRef ?? ""}
            placeholder="e.g. 6420"
            disabled={!enabled}
          />
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RestoreButton } from "@/components/ui/restore-button";
import { fmtDate, money } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  VendorRateAgreementPricing,
  type AgreementPricingLine,
  type InteriorCodeChoice,
} from "@/components/vendor-rate-agreement-pricing";
import {
  activateRateAgreement,
  archiveRateAgreement,
  createRateAgreement,
  endRateAgreement,
  restoreRateAgreement,
} from "@/lib/actions/rate-agreements";

export type AgreementListItem = {
  id: number;
  vendorId: number;
  vendorName: string;
  name: string | null;
  status: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  lines: { id: number; costCodeId: number; pricingMethod: AgreementPricingLine["pricingMethod"]; unitPrice: number }[];
};

export type ArchivedAgreementListItem = {
  id: number;
  vendorName: string;
  name: string | null;
  archivedAt: string;
};

const STATUS_VARIANT: Record<string, "positive" | "secondary" | "outline"> = {
  active: "positive",
  draft: "secondary",
  ended: "outline",
};

/**
 * Vendors who have committed to a standing per-category rate against this
 * tier — the digital half of the bid-sheet ritual (see the "Bid sheet" link
 * above): print it, get it priced by hand, then bring the numbers back here
 * so a unit turned to this tier can be awarded with one click instead of a
 * fresh RFP every time.
 */
export function VendorRateAgreementsSection({
  propertyId,
  budgetGroupId,
  agreements,
  archivedAgreements = [],
  vendors,
  interiorCodes,
}: {
  propertyId: number;
  budgetGroupId: number;
  agreements: AgreementListItem[];
  /** Removed agreements — shown behind a "Show archived" toggle. */
  archivedAgreements?: ArchivedAgreementListItem[];
  vendors: { id: number; name: string; trade: string | null }[];
  interiorCodes: InteriorCodeChoice[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [vendorId, setVendorId] = useState("");
  const [name, setName] = useState("");
  const [seed, setSeed] = useState(true);
  const [showArchived, setShowArchived] = useState(false);

  const codeById = new Map(interiorCodes.map((c) => [c.id, c]));
  const availableVendors = vendors.filter(
    (v) => !agreements.some((a) => a.vendorId === v.id && a.status !== "ended"),
  );

  function linesFor(a: AgreementListItem): AgreementPricingLine[] {
    return a.lines.map((l) => {
      const code = codeById.get(l.costCodeId);
      return {
        id: l.id,
        costCodeId: l.costCodeId,
        code: code?.code ?? `#${l.costCodeId}`,
        label: code?.name ?? `Code #${l.costCodeId}`,
        pricingMethod: l.pricingMethod,
        unitPrice: l.unitPrice,
      };
    });
  }

  function totalFor(a: AgreementListItem): number {
    return a.lines.reduce((s, l) => s + l.unitPrice, 0);
  }

  function create() {
    if (!vendorId) {
      toast.error("Choose a vendor");
      return;
    }
    startTransition(async () => {
      const res = await createRateAgreement({
        propertyId,
        budgetGroupId,
        vendorId: Number(vendorId),
        name: name.trim() || undefined,
        seedFromTierDefaults: seed,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Agreement created — draft until activated");
      setCreating(false);
      setVendorId("");
      setName("");
      setExpanded(res.agreementId);
      router.refresh();
    });
  }

  function activate(id: number) {
    startTransition(async () => {
      const res = await activateRateAgreement({ id, propertyId });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Agreement activated");
      router.refresh();
    });
  }

  function end(id: number) {
    startTransition(async () => {
      const res = await endRateAgreement({ id, propertyId });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Agreement ended");
      router.refresh();
    });
  }

  function archive(id: number) {
    startTransition(async () => {
      const res = await archiveRateAgreement({ id, propertyId });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Agreement removed");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Vendor pricing</CardTitle>
        <p className="text-sm text-muted-foreground">
          A vendor&apos;s standing price for every unit turned to this type — award a unit under an
          active agreement from its Bid gate instead of sending a fresh RFP.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {agreements.length === 0 && !creating && (
          <p className="rounded-card border border-dashed border-border px-3 py-6 text-center text-[13px] text-muted-foreground">
            No standing agreements yet.
          </p>
        )}

        {agreements.map((a) => {
          const open = expanded === a.id;
          return (
            <div key={a.id} className="rounded-card border border-border">
              {/* A div, not a button: the row toggles expansion, but it also
                  holds real <Button>s for Activate/End/Remove, and a button
                  inside a button is invalid HTML — browsers drop one of them
                  and the click targets fight (see project-scope-list.tsx). */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => setExpanded(open ? null : a.id)}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setExpanded(open ? null : a.id);
                  }
                }}
                className="flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left hover:bg-hover"
              >
                {open ? (
                  <ChevronDownIcon className="size-4 shrink-0 text-ink-300" />
                ) : (
                  <ChevronRightIcon className="size-4 shrink-0 text-ink-300" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-navy">{a.vendorName}</span>
                    <Badge variant={STATUS_VARIANT[a.status] ?? "outline"} className="capitalize">
                      {a.status}
                    </Badge>
                    {a.name && <span className="text-xs text-muted-foreground">{a.name}</span>}
                  </span>
                  <span className="mt-0.5 block text-[11.5px] text-muted-foreground">
                    {`${a.lines.length} line${a.lines.length === 1 ? "" : "s"} · ${money(totalFor(a))} per unit${
                      a.effectiveFrom ? ` · from ${fmtDate(a.effectiveFrom)}` : ""
                    }${a.effectiveTo ? ` to ${fmtDate(a.effectiveTo)}` : ""}`}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                  {a.status !== "active" && (
                    <Button size="sm" variant="outline" disabled={pending} onClick={() => activate(a.id)}>
                      Activate
                    </Button>
                  )}
                  {a.status === "active" && (
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => end(a.id)}>
                      End
                    </Button>
                  )}
                  {a.status !== "active" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-alert hover:text-alert"
                      disabled={pending}
                      onClick={() => archive(a.id)}
                    >
                      Remove
                    </Button>
                  )}
                </span>
              </div>
              {open && (
                <div className={cn("border-t border-border p-3")}>
                  <VendorRateAgreementPricing
                    propertyId={propertyId}
                    agreementId={a.id}
                    lines={linesFor(a)}
                    interiorCodes={interiorCodes}
                  />
                </div>
              )}
            </div>
          );
        })}

        {creating ? (
          <div className="space-y-3 rounded-card border border-border bg-muted/20 p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="new-agreement-vendor">Vendor</Label>
                <select
                  id="new-agreement-vendor"
                  value={vendorId}
                  onChange={(e) => setVendorId(e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <option value="" disabled>
                    Select a vendor…
                  </option>
                  {availableVendors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.trade ? `${v.name} — ${v.trade}` : v.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-agreement-name">Label (optional)</Label>
                <Input
                  id="new-agreement-name"
                  placeholder="e.g. 2026 turn rates"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-[13px] text-ink-600">
              <input
                type="checkbox"
                className="size-3.5 accent-navy"
                checked={seed}
                onChange={(e) => setSeed(e.target.checked)}
              />
              Start from this type&apos;s current prices
            </label>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => setCreating(false)}>
                Cancel
              </Button>
              <Button size="sm" disabled={pending} onClick={create}>
                Create agreement
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            {archivedAgreements.length > 0 ? (
              <button
                type="button"
                onClick={() => setShowArchived((s) => !s)}
                className="text-[11.5px] text-muted-foreground underline-offset-2 hover:underline"
              >
                {showArchived ? "Hide" : "Show"} archived ({archivedAgreements.length})
              </button>
            ) : (
              <span />
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={availableVendors.length === 0}
              onClick={() => setCreating(true)}
            >
              New agreement
            </Button>
          </div>
        )}

        {showArchived && archivedAgreements.length > 0 && (
          <div className="divide-y divide-hairline rounded-card border border-border">
            {archivedAgreements.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-3 px-3 py-2 text-[13px]">
                <span className="min-w-0 flex-1 truncate text-ink-300 line-through">
                  {a.vendorName}
                  {a.name && ` — ${a.name}`}
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  <span className="text-[11px] text-muted-foreground">{fmtDate(a.archivedAt)}</span>
                  <RestoreButton
                    onRestore={() => restoreRateAgreement({ id: a.id, propertyId })}
                    successMessage="Agreement restored"
                  />
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

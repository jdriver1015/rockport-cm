"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScopePanel, readinessOf, type PreWalkFinding, type ScopeLine } from "@/components/scope-panel";
import { BidsPanel } from "@/components/bids-panel";
import type { BidPackageOption } from "@/lib/bid-package";

type Tab = "scope" | "bids";

/**
 * Resolve the Scope & Bids gate: write the scope, send it out, pick a price.
 *
 * One dialog with the two halves as tabs, because they are one piece of work
 * done in order — and the scope is confirmed by sending it, not by a button of
 * its own, so there is no longer a moment between the two that needs a
 * separate screen.
 */
export function ScopeBidsDialog({
  open,
  onOpenChange,
  propertyId,
  projectId,
  lines,
  requireDescriptions,
  scopeConfirmedAt,
  scopeLocked,
  liveRfpCount,
  findings,
  bidPackage,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  propertyId: number;
  projectId: number;
  lines: ScopeLine[];
  requireDescriptions: boolean;
  scopeConfirmedAt: string | null;
  scopeLocked: boolean;
  liveRfpCount: number;
  findings: PreWalkFinding[];
  bidPackage: BidPackageOption;
}) {
  // Opens where the work is: on the scope until anything has gone out, on the
  // bids from then on.
  const [tab, setTab] = useState<Tab>(bidPackage.bids.length > 0 || scopeLocked ? "bids" : "scope");

  // An already-confirmed scope has nothing left to clear; otherwise the exact
  // rule — and message — the server applies when sending confirms it.
  const scopeBlocker = scopeConfirmedAt ? null : readinessOf(lines, requireDescriptions).blocker;
  const hasAward = bidPackage.bids.some((b) => b.approved);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Scope &amp; bids</DialogTitle>
          <DialogDescription>
            What the vendors will price, then who prices it and who gets it. Sending the scope out
            confirms it and locks it while they price.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
          <TabsList>
            <TabsTrigger value="scope">
              Scope · {lines.length} line{lines.length === 1 ? "" : "s"}
            </TabsTrigger>
            <TabsTrigger value="bids">
              Bids{bidPackage.bids.length > 0 ? ` · ${bidPackage.bids.length}` : ""}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="scope" className="pt-2">
            <ScopePanel
              propertyId={propertyId}
              projectId={projectId}
              lines={lines}
              requireDescriptions={requireDescriptions}
              scopeConfirmedAt={scopeConfirmedAt}
              scopeLocked={scopeLocked}
              liveRfpCount={liveRfpCount}
              findings={findings}
              hasAward={hasAward}
              onContinue={() => setTab("bids")}
            />
          </TabsContent>

          <TabsContent value="bids" className="pt-2">
            <BidsPanel
              propertyId={propertyId}
              projectId={projectId}
              data={bidPackage}
              scopeBlocker={scopeBlocker}
              onEditScope={() => setTab("scope")}
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

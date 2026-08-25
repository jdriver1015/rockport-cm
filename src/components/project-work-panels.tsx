"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { cn } from "@/lib/utils";

export type PanelKey = "scope" | "workflow";

type PanelState = {
  tab: PanelKey;
  setTab: (next: PanelKey) => void;
  scopeCount: number;
  /** Gate progress for leaving the current phase. Null in the last phase. */
  gate: { met: number; total: number } | null;
};

const PanelContext = createContext<PanelState | null>(null);

/**
 * The scope table and the phase workflow, one at a time, behind a pill switch.
 *
 * Both panels are server-rendered by the page and handed in as elements. The
 * page loads scope, milestones and gate state in a single pass, so routing the
 * switch through the URL the way the budget tabs do would re-run every one of
 * those queries to change which of two already-rendered panels is on screen.
 * The tab is client state instead — it survives the router.refresh() the gate
 * dialogs fire — mirrored into ?tab= with replaceState so a reload, a bookmark
 * or a shared link lands on the panel you were looking at.
 */
export function ProjectWorkPanels({
  initialTab,
  scopeCount,
  gate,
  scope,
  workflow,
}: {
  initialTab: PanelKey;
  scopeCount: number;
  gate: { met: number; total: number } | null;
  scope: ReactNode;
  workflow: ReactNode;
}) {
  const [tab, setTabState] = useState<PanelKey>(initialTab);

  function setTab(next: PanelKey) {
    setTabState(next);
    const url = new URL(window.location.href);
    if (next === "scope") url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    window.history.replaceState(null, "", url);
  }

  return (
    <PanelContext.Provider value={{ tab, setTab, scopeCount, gate }}>
      {tab === "scope" ? scope : workflow}
    </PanelContext.Provider>
  );
}

/** The count beside a segment's name. White on the selected navy segment. */
function Count({ children, tone }: { children: ReactNode; tone?: "alert" }) {
  return (
    <span
      className={cn(
        "rounded-full px-1.5 py-px text-[11px] font-bold tabular-nums",
        tone === "alert" ? "bg-alert/10 text-alert" : "bg-white text-ink-400",
        "group-data-[active=true]/segment:bg-white/20 group-data-[active=true]/segment:text-white",
      )}
    >
      {children}
    </span>
  );
}

/**
 * The switch itself, rendered from inside whichever panel is showing so it sits
 * in that panel's own card header rather than floating above the card. Renders
 * nothing outside a ProjectWorkPanels.
 */
export function ProjectPanelSwitch() {
  const ctx = useContext(PanelContext);
  if (!ctx) return null;
  const { tab, setTab, scopeCount, gate } = ctx;

  return (
    <SegmentedControl<PanelKey>
      value={tab}
      onChange={setTab}
      options={[
        {
          key: "scope",
          label: (
            <>
              Scope
              <Count>{scopeCount}</Count>
            </>
          ),
        },
        {
          key: "workflow",
          label: (
            <>
              Workflow
              {gate && (
                // Red at zero: with the panel hidden, this pill is the only
                // thing saying the phase cannot be left yet.
                <Count tone={gate.met === 0 ? "alert" : undefined}>
                  {gate.met}/{gate.total}
                </Count>
              )}
            </>
          ),
        },
      ]}
    />
  );
}

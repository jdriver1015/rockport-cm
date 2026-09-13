"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { cn } from "@/lib/utils";

export type PanelKey = "scope" | "workflow" | "documents";

/** Just enough of a GateCheck to color one tick. */
export type GateTick = { met: boolean; next?: boolean };

type PanelState = {
  tab: PanelKey;
  setTab: (next: PanelKey) => void;
  scopeCount: number;
  /** Gate progress for leaving the current phase. Null in the last phase. */
  gate: { met: number; total: number; checks: GateTick[] } | null;
  documentsCount: number;
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
  documentsCount,
  scope,
  workflow,
  documents,
}: {
  initialTab: PanelKey;
  scopeCount: number;
  gate: { met: number; total: number; checks: GateTick[] } | null;
  documentsCount: number;
  scope: ReactNode;
  workflow: ReactNode;
  documents: ReactNode;
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
    <PanelContext.Provider value={{ tab, setTab, scopeCount, gate, documentsCount }}>
      {tab === "scope" ? scope : tab === "workflow" ? workflow : documents}
    </PanelContext.Provider>
  );
}

/** The count beside a segment's name. White on the selected navy segment. */
function Count({ children }: { children: ReactNode }) {
  return (
    <span
      className={cn(
        "rounded-full bg-white px-1.5 py-px text-[11px] font-bold tabular-nums text-ink-400",
        "group-data-[active=true]/segment:bg-white/20 group-data-[active=true]/segment:text-white",
      )}
    >
      {children}
    </span>
  );
}

/**
 * A miniature of the gate progress bar shown inside the Workflow panel itself
 * (see project-phases.tsx's GateRow) — one tick per check, colored by state.
 *
 * Not a numeral badge: "met/total" as a fraction chip next to plain item
 * counts on the other two tabs made the switch read as three inconsistent
 * chips — a fixed-width, 3-character-wide pill beside two 1-character ones,
 * and (on the active navy segment) a washed-out 20%-opacity fill beside two
 * solid ones. Progress toward unlocking the next phase is a different kind of
 * fact than "how many items", so it gets a different shape here, one that
 * can't grow or shrink with the numbers.
 */
function GateTicks({ checks }: { checks: GateTick[] }) {
  return (
    <span className="flex w-8 shrink-0 gap-0.5" aria-hidden>
      {checks.map((c, i) => (
        <span
          key={i}
          className={cn(
            "h-[3px] flex-1 rounded-full",
            c.met
              ? "bg-positive"
              : c.next
                ? "bg-navy/40 group-data-[active=true]/segment:bg-white/60"
                : "bg-track group-data-[active=true]/segment:bg-white/20",
          )}
        />
      ))}
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
  const { tab, setTab, scopeCount, gate, documentsCount } = ctx;

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
              {gate && <GateTicks checks={gate.checks} />}
            </>
          ),
        },
        {
          key: "documents",
          label: (
            <>
              Documents
              <Count>{documentsCount}</Count>
            </>
          ),
        },
      ]}
    />
  );
}

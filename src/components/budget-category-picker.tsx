"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { moneyOrZero } from "@/lib/format";
import { DIVISIONS } from "@/lib/divisions";
import type { BudgetLineOption } from "@/components/common-project-wizard";

// ---------------------------------------------------------------------------
// Which budget categories will this project touch?
//
// A property carries around fifty of these, which is far too many to face as
// one list. They already group into four divisions, so the default view is four
// rows carrying a count and a total — often enough to know where to look without
// opening anything. Search flattens it for somebody who already knows the name.
//
// Exhausted categories are shown, greyed, rather than hidden. Spending past an
// underwritten allowance is a real decision the wizard already permits and says
// out loud; hiding the evidence would be the app quietly making it instead.
// ---------------------------------------------------------------------------

export const remainingOn = (b: BudgetLineOption) => b.approved - b.allocated;

export function BudgetCategoryPicker({
  options,
  selected,
  onToggle,
}: {
  options: BudgetLineOption[];
  selected: Set<number>;
  onToggle: (costCodeId: number, next: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());

  const q = query.trim().toLowerCase();
  const matches = useMemo(
    () =>
      q
        ? options.filter(
            (o) =>
              o.name.toLowerCase().includes(q) ||
              (o.categoryName ?? "").toLowerCase().includes(q) ||
              o.code.toLowerCase().includes(q),
          )
        : options,
    [options, q],
  );

  // Divisions in their canonical order, plus a bucket for anything uncoded, so
  // a category with no division is still reachable rather than silently absent.
  const groups = useMemo(() => {
    const known = DIVISIONS.map((d) => ({
      key: d.key as string,
      label: d.label,
      rows: matches.filter((o) => o.division === d.key),
    }));
    const rest = matches.filter((o) => !DIVISIONS.some((d) => d.key === o.division));
    return [...known, { key: "other", label: "Other", rows: rest }].filter(
      (g) => g.rows.length > 0,
    );
  }, [matches]);

  const chosen = options.filter((o) => selected.has(o.costCodeId));
  const chosenTotal = chosen.reduce((n, o) => n + Math.max(0, remainingOn(o)), 0);

  return (
    <div className="space-y-2">
      <Input
        value={query}
        placeholder="Search categories…"
        className="h-9"
        onChange={(e) => setQuery(e.target.value)}
      />

      {groups.length === 0 ? (
        <p className="rounded-card border border-border px-3 py-4 text-center text-[12.5px] text-muted-foreground">
          Nothing matches “{query.trim()}”.
        </p>
      ) : (
        <div className="divide-y divide-hairline overflow-hidden rounded-card border border-border">
          {groups.map((g) => {
            // A search has already narrowed things, so keeping its results shut
            // would hide the answer somebody just asked for.
            const expanded = q.length > 0 || open.has(g.key);
            const left = g.rows.reduce((n, o) => n + Math.max(0, remainingOn(o)), 0);
            const picked = g.rows.filter((o) => selected.has(o.costCodeId)).length;
            return (
              <div key={g.key}>
                <button
                  type="button"
                  onClick={() =>
                    setOpen((prev) => {
                      const next = new Set(prev);
                      if (next.has(g.key)) next.delete(g.key);
                      else next.add(g.key);
                      return next;
                    })
                  }
                  className="flex w-full items-center gap-2 bg-muted/40 px-3 py-2 text-left hover:bg-muted"
                >
                  {expanded ? (
                    <ChevronDown className="size-3.5 shrink-0 text-ink-400" />
                  ) : (
                    <ChevronRight className="size-3.5 shrink-0 text-ink-400" />
                  )}
                  <span className="flex-1 text-[12.5px] font-medium text-navy">{g.label}</span>
                  {picked > 0 && (
                    <span className="shrink-0 rounded-control bg-navy px-1.5 py-0.5 text-[10.5px] font-medium text-white">
                      {picked}
                    </span>
                  )}
                  <span className="shrink-0 text-[11.5px] text-muted-foreground tabular-nums">
                    {g.rows.length} {g.rows.length === 1 ? "category" : "categories"} ·{" "}
                    {moneyOrZero(left)} left
                  </span>
                </button>

                {expanded &&
                  g.rows.map((o) => {
                    const left = remainingOn(o);
                    const on = selected.has(o.costCodeId);
                    const spent = left <= 0.005;
                    return (
                      <label
                        key={o.costCodeId}
                        className="flex cursor-pointer items-center gap-2.5 border-t border-hairline py-1.5 pr-3 pl-8 hover:bg-hover"
                      >
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={(e) => onToggle(o.costCodeId, e.target.checked)}
                          className="size-3.5 shrink-0 accent-navy"
                        />
                        <span
                          className={cn(
                            "flex-1 truncate text-[13px]",
                            spent && !on ? "text-ink-300" : "text-ink-700",
                          )}
                        >
                          {o.name}
                        </span>
                        <span
                          className={cn(
                            "shrink-0 text-[12px] tabular-nums",
                            left < -0.005
                              ? "text-alert"
                              : spent
                                ? "text-ink-300"
                                : "text-ink-500",
                          )}
                        >
                          {left < -0.005
                            ? `over by ${moneyOrZero(Math.abs(left))}`
                            : `${moneyOrZero(left)} left`}
                        </span>
                      </label>
                    );
                  })}
              </div>
            );
          })}
        </div>
      )}

      <p className="px-0.5 text-[12px] text-muted-foreground">
        {chosen.length === 0 ? (
          "Nothing selected yet — you can also add lines by hand on the next step."
        ) : (
          <>
            {chosen.length} {chosen.length === 1 ? "category" : "categories"} selected ·{" "}
            <span className="font-medium text-navy">{moneyOrZero(chosenTotal)}</span> available
            across them
          </>
        )}
      </p>
    </div>
  );
}

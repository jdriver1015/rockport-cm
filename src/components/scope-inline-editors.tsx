"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { LockIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { updateScopeItem } from "@/lib/actions/scope";
import { cn } from "@/lib/utils";

export type SpecGrid = { cols: string[]; rows: string[][] };

const DEFAULT_SPEC_COLS = ["Item", "Product", "Notes"];

const HEADING = "text-[10px] font-bold uppercase tracking-[0.1em] text-ink-300";

/**
 * Editing a line's prose without opening the whole line.
 *
 * The dialog still owns everything structural — name, code, units, price, dates
 * — but a description and a spec row are the two things somebody adds while
 * reading down the table, and making them a round trip through a modal is why
 * most lines have neither.
 *
 * Frozen once the line is out for bid. A vendor is pricing this exact text, so
 * changing it here would quietly put the quote and the record out of step; the
 * popover says so instead of disabling itself with no explanation.
 */
function FrozenNote({ vendors }: { vendors: number }) {
  return (
    <div className="w-[300px]">
      <div className={HEADING}>Out for bid</div>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-500">
        {vendors} vendor{vendors === 1 ? " is" : "s are"} pricing this line. Its description and
        specifications are what they were asked to quote, so they cannot change until the request
        {vendors === 1 ? " is" : "s are"} withdrawn.
      </p>
    </div>
  );
}

export function DescriptionEditor({
  scopeItemId,
  propertyId,
  projectId,
  value,
  outForBid,
  vendorsPricing,
  children,
}: {
  scopeItemId: number;
  propertyId: number;
  projectId: number;
  value: string;
  outForBid: boolean;
  vendorsPricing: number;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [pending, startTransition] = useTransition();

  function save() {
    if (draft.trim() === value.trim()) {
      setOpen(false);
      return;
    }
    startTransition(async () => {
      const res = await updateScopeItem({
        id: scopeItemId,
        propertyId,
        projectId,
        materialQuality: draft,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        // Reset from the row on each open: a refresh may have changed it under
        // a stale draft.
        if (next) setDraft(value);
        setOpen(next);
      }}
    >
      <PopoverTrigger
        render={
          <span
            // The row itself opens the dialog, so a click meant for the
            // description must not also open it.
            onClick={(e) => e.stopPropagation()}
            className="cursor-text rounded-[5px] transition-colors hover:bg-hover"
          />
        }
      >
        {children}
      </PopoverTrigger>

      <PopoverContent onClick={(e) => e.stopPropagation()}>
        {outForBid ? (
          <FrozenNote vendors={vendorsPricing} />
        ) : (
          <div className="w-[390px]">
            <div className={HEADING}>Scope narrative</div>
            <textarea
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="What the contractor is responsible for on this line."
              onKeyDown={(e) => {
                if (e.key === "Escape") setOpen(false);
                // Enter saves; Shift+Enter is a paragraph break, because a scope
                // narrative is often more than one sentence.
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  save();
                }
              }}
              className="mt-1.5 min-h-[76px] w-full resize-y rounded-control border border-input bg-transparent px-2.5 py-2 text-[13px] leading-relaxed outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
            />
            <div className="mt-2 flex items-center gap-2">
              <span className="mr-auto text-[11px] text-ink-300">⏎ to save · Esc to cancel</span>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button size="sm" disabled={pending} onClick={save}>
                Save
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function SpecsEditor({
  scopeItemId,
  propertyId,
  projectId,
  specs,
  outForBid,
  vendorsPricing,
  children,
}: {
  scopeItemId: number;
  propertyId: number;
  projectId: number;
  specs: SpecGrid | null;
  outForBid: boolean;
  vendorsPricing: number;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [grid, setGrid] = useState<SpecGrid>(specs ?? { cols: DEFAULT_SPEC_COLS, rows: [] });

  function commit(next: SpecGrid) {
    setGrid(next);
    startTransition(async () => {
      // Blank rows are how a half-finished edit looks; they are not data.
      const rows = next.rows.filter((r) => r.some((c) => c.trim()));
      const res = await updateScopeItem({
        id: scopeItemId,
        propertyId,
        projectId,
        specs: rows.length ? { cols: next.cols, rows } : null,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      router.refresh();
    });
  }

  const setCell = (ri: number, ci: number, v: string) =>
    setGrid({
      cols: grid.cols,
      rows: grid.rows.map((r, i) => (i === ri ? r.map((c, j) => (j === ci ? v : c)) : r)),
    });

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setGrid(specs ?? { cols: DEFAULT_SPEC_COLS, rows: [] });
        setOpen(next);
      }}
    >
      <PopoverTrigger
        render={<span onClick={(e) => e.stopPropagation()} className="cursor-pointer" />}
      >
        {children}
      </PopoverTrigger>

      <PopoverContent onClick={(e) => e.stopPropagation()}>
        {outForBid ? (
          <FrozenNote vendors={vendorsPricing} />
        ) : (
          <div className="w-[470px]">
            <div className={cn(HEADING, "mb-2")}>Product specifications</div>

            <div className="grid grid-cols-[1fr_1.3fr_1fr_24px] items-center gap-1.5">
              {grid.cols.map((c) => (
                <div key={c} className="text-[9px] font-bold uppercase tracking-[0.1em] text-ink-300">
                  {c}
                </div>
              ))}
              <div />

              {grid.rows.map((row, ri) => (
                <RowFields
                  key={ri}
                  cols={grid.cols}
                  row={row}
                  onChange={(ci, v) => setCell(ri, ci, v)}
                  onBlur={() => commit(grid)}
                  onRemove={() =>
                    commit({ cols: grid.cols, rows: grid.rows.filter((_, i) => i !== ri) })
                  }
                />
              ))}
            </div>

            {grid.rows.length === 0 && (
              <p className="py-2 text-[12px] text-ink-300">
                Nothing specified yet — add the products this line is built from.
              </p>
            )}

            <button
              type="button"
              disabled={pending}
              onClick={() =>
                setGrid({
                  cols: grid.cols,
                  rows: [...grid.rows.map((r) => r.slice()), grid.cols.map(() => "")],
                })
              }
              className="mt-2 text-[12px] text-ink-500 underline underline-offset-[3px] hover:text-navy"
            >
              + Add another
            </button>

            <div className="mt-2.5 flex items-center gap-2">
              <span className="mr-auto text-[11px] text-ink-300">Saves as you go</span>
              <Button size="sm" disabled={pending} onClick={() => setOpen(false)}>
                Done
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function RowFields({
  cols,
  row,
  onChange,
  onBlur,
  onRemove,
}: {
  cols: string[];
  row: string[];
  onChange: (ci: number, value: string) => void;
  onBlur: () => void;
  onRemove: () => void;
}) {
  return (
    <>
      {cols.map((c, ci) => (
        <input
          key={c}
          value={row[ci] ?? ""}
          placeholder={c}
          onChange={(e) => onChange(ci, e.target.value)}
          onBlur={onBlur}
          className="h-7 w-full rounded-control border border-input bg-transparent px-2 text-[12.5px] outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
        />
      ))}
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove specification"
        className="text-ink-200 transition-colors hover:text-alert"
      >
        ×
      </button>
    </>
  );
}

/** The chip a line wears while vendors are holding it. */
export function OutForBidChip({ vendors }: { vendors: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded bg-track px-1.5 py-px text-[10px] font-semibold text-ink-400"
      title={`Out for bid — ${vendors} vendor${vendors === 1 ? " is" : "s are"} pricing. Price, code, description and specs are frozen.`}
    >
      <LockIcon className="size-2.5" />
      Out for bid
    </span>
  );
}

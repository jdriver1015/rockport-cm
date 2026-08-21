"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { importFindingsToScope } from "@/lib/actions/pre-walk";
import { createScopeItem } from "@/lib/actions/scope";

export type PreWalkFinding = {
  id: number;
  title: string;
  description: string | null;
  severity: string;
  location: string | null;
  /** Already turned into a scope line. */
  inScope: boolean;
};

/**
 * Resolve the Define Scope gate.
 *
 * Deliberately not a second copy of the scope editor — that is on the page
 * already, a few inches below. What this offers is the thing that gets a project
 * from no scope to some: the pre-walk's findings, and a one-line add for
 * anything the walk missed.
 */
export function DefineScopeDialog({
  open,
  onOpenChange,
  propertyId,
  projectId,
  scopeLineCount,
  findings,
  hasPreWalk,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  propertyId: number;
  projectId: number;
  scopeLineCount: number;
  findings: PreWalkFinding[];
  /** False when no pre-walk has been started, which changes the empty state. */
  hasPreWalk: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const importable = findings.filter((f) => !f.inScope);
  // Default to all, as with every other bulk action here.
  const [picked, setPicked] = useState<Set<number>>(() => new Set(importable.map((f) => f.id)));
  const [manual, setManual] = useState("");

  function importPicked() {
    if (picked.size === 0) return;
    startTransition(async () => {
      const res = await importFindingsToScope({ projectId, findingIds: [...picked] });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        res.skipped > 0
          ? `${res.added} line(s) added — ${res.skipped} were already scope`
          : `${res.added} line(s) added to scope`,
      );
      router.refresh();
    });
  }

  function addManual() {
    const item = manual.trim();
    if (!item) return;
    startTransition(async () => {
      const res = await createScopeItem({ propertyId, projectId, item });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setManual("");
      toast.success(`Added ${item}`);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Define scope</DialogTitle>
          <DialogDescription>
            {scopeLineCount > 0
              ? `${scopeLineCount} line${scopeLineCount === 1 ? "" : "s"} so far. Pricing comes from the bid — nothing here is costed.`
              : "The scope is what you send out for bid. Pricing comes back from the vendors."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-ink-300">
                From the pre-walk
              </span>
              {importable.length > 0 && (
                <button
                  type="button"
                  className="text-[11px] text-link hover:underline"
                  onClick={() =>
                    setPicked((p) =>
                      p.size === importable.length ? new Set() : new Set(importable.map((f) => f.id)),
                    )
                  }
                >
                  {picked.size === importable.length ? "Clear all" : "Select all"}
                </button>
              )}
            </div>

            {!hasPreWalk ? (
              <p className="rounded-card border border-border bg-muted/30 px-3 py-3 text-[13px] text-muted-foreground">
                No pre-walk yet. Walk the unit first and its findings will land here — that is what
                the scope is written from.
              </p>
            ) : findings.length === 0 ? (
              <p className="rounded-card border border-border bg-muted/30 px-3 py-3 text-[13px] text-muted-foreground">
                The pre-walk has no findings recorded yet.
              </p>
            ) : (
              <div className="max-h-64 divide-y divide-hairline overflow-y-auto rounded-card border border-border">
                {findings.map((f) => (
                  <label
                    key={f.id}
                    className={cn(
                      "flex items-start gap-2.5 px-3 py-2",
                      f.inScope ? "bg-hairline/50" : "cursor-pointer hover:bg-track",
                    )}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 size-3.5 accent-navy"
                      disabled={f.inScope || pending}
                      checked={f.inScope || picked.has(f.id)}
                      onChange={(e) =>
                        setPicked((p) => {
                          const next = new Set(p);
                          if (e.target.checked) next.add(f.id);
                          else next.delete(f.id);
                          return next;
                        })
                      }
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-baseline gap-2">
                        <span
                          className={cn(
                            "text-[13px]",
                            f.inScope ? "text-ink-300" : "font-medium text-navy",
                          )}
                        >
                          {f.title}
                        </span>
                        {f.location && (
                          <span className="text-[11px] text-muted-foreground">{f.location}</span>
                        )}
                        {f.inScope && (
                          <span className="text-[10.5px] uppercase tracking-[0.09em] text-ink-300">
                            already scope
                          </span>
                        )}
                      </span>
                      {f.description && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {f.description}
                        </span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            )}

            {importable.length > 0 && (
              <div className="flex justify-end">
                <Button size="sm" disabled={pending || picked.size === 0} onClick={importPicked}>
                  Add {picked.size} to scope
                </Button>
              </div>
            )}
          </div>

          <div className="space-y-2 border-t border-border pt-4">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-ink-300">
              Add a line the walk missed
            </span>
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                addManual();
              }}
            >
              <Input
                className="h-8 min-w-64 flex-1 text-xs"
                placeholder="e.g. Replace bathroom exhaust fan"
                value={manual}
                disabled={pending}
                onChange={(e) => setManual(e.target.value)}
              />
              <Button type="submit" size="sm" variant="outline" disabled={pending || !manual.trim()}>
                Add line
              </Button>
            </form>
            <p className="text-[11px] text-muted-foreground">
              Cost codes, quantities and dates are set on the scope list below — this just gets the
              line onto it.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

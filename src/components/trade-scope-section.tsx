"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  copyTradeScopes,
  deleteTradeScope,
  saveTradeScope,
} from "@/lib/actions/trade-scope";
import { isWritten, writtenCount, type TradeScopeEntry } from "@/lib/trade-scope";

/** Which level this section is editing. Mirrors the action's owner union. */
export type ScopeOwner =
  | { level: "template"; templateId: number }
  | { level: "group"; budgetGroupId: number; propertyId: number };

export type CopySource = { owner: ScopeOwner; label: string; writtenCount: number };

/**
 * The written trade scope for one renovation type — the narrative a GC bids
 * from.
 *
 * All thirteen standard trades are always listed, unwritten ones included: the
 * gaps are the point. A bid sheet that silently omits Electrical reads as though
 * electrical work isn't in scope, so the unwritten trades have to be as visible
 * here as the written ones.
 */
export function TradeScopeSection({
  owner,
  entries,
  copySources,
}: {
  owner: ScopeOwner;
  entries: TradeScopeEntry[];
  copySources: CopySource[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [openHeading, setOpenHeading] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [addingCustom, setAddingCustom] = useState(false);

  const { written, total } = writtenCount(entries);

  function open(entry: TradeScopeEntry) {
    setOpenHeading(entry.heading);
    setDraft(entry.body ?? "");
  }

  function commit(heading: string, body: string, original: string | null) {
    setOpenHeading(null);
    if (body.trim() === (original ?? "").trim()) return;
    startTransition(async () => {
      const res = await saveTradeScope({ owner, heading, body });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.written ? `${heading} scope saved` : `${heading} scope cleared`);
      router.refresh();
    });
  }

  function remove(heading: string) {
    startTransition(async () => {
      const res = await deleteTradeScope({ owner, heading });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`${heading} scope removed`);
      router.refresh();
    });
  }

  function copyFrom(source: CopySource) {
    startTransition(async () => {
      const res = await copyTradeScopes({ to: owner, from: source.owner });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      // Say what was skipped: a silent "12 copied" when 3 were left alone reads
      // as though this type's own wording had been replaced.
      toast.success(
        res.skipped > 0
          ? `${res.copied} scope(s) copied — ${res.skipped} left alone because this type already has its own`
          : `${res.copied} scope(s) copied from ${source.label}`,
      );
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3 px-4">
        <p className="text-sm text-muted-foreground">
          <span className="font-semibold tabular-nums text-navy">
            {written} of {total}
          </span>{" "}
          written. Unwritten trades still appear on the bid sheet, marked as not yet scoped.
        </p>
        {copySources.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Copy from</span>
            {copySources.map((s) => (
              <Button
                key={`${s.owner.level}:${s.label}`}
                size="sm"
                variant="outline"
                disabled={pending || s.writtenCount === 0}
                title={
                  s.writtenCount === 0
                    ? `${s.label} has no written scopes yet`
                    : `Copy ${s.writtenCount} scope(s), skipping trades already written here`
                }
                onClick={() => copyFrom(s)}
              >
                {s.label}
              </Button>
            ))}
          </div>
        )}
      </div>

      <div className="divide-y divide-hairline border-y border-border">
        {entries.map((entry) => {
          const editing = openHeading === entry.heading;
          const done = isWritten(entry);
          return (
            <div key={entry.heading} className={cn("px-4 py-3", editing && "bg-hover")}>
              <div className="flex items-baseline gap-2.5">
                <span
                  aria-hidden
                  className={cn(
                    "mt-1.5 size-1.5 shrink-0 rounded-full",
                    done ? "bg-positive" : "bg-ink-100",
                  )}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span
                      className={cn(
                        "text-[13.5px]",
                        done ? "font-medium text-navy" : "text-ink-300",
                      )}
                    >
                      {entry.heading}
                      {entry.custom && (
                        <span className="ml-2 text-[10.5px] uppercase tracking-[0.09em] text-ink-300">
                          Added here
                        </span>
                      )}
                    </span>
                    {!editing && (
                      <span className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={pending}
                          onClick={() => open(entry)}
                        >
                          {done ? "Edit" : "Write scope"}
                        </Button>
                        {done && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={pending}
                            onClick={() => remove(entry.heading)}
                          >
                            Clear
                          </Button>
                        )}
                      </span>
                    )}
                  </div>

                  {editing ? (
                    <div className="mt-2 space-y-2">
                      <textarea
                        autoFocus
                        rows={5}
                        value={draft}
                        disabled={pending}
                        onChange={(e) => setDraft(e.target.value)}
                        onBlur={() => commit(entry.heading, draft, entry.body)}
                        placeholder={`What the contractor is responsible for under ${entry.heading.toLowerCase()}…`}
                        className="w-full rounded-control border border-input bg-card px-2.5 py-2 text-[13px] leading-relaxed outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                      />
                      <p className="text-[11px] text-muted-foreground">
                        Saves when you click away. Clearing the text removes the scope.
                      </p>
                    </div>
                  ) : done ? (
                    <p className="mt-1 whitespace-pre-line text-[13px] leading-relaxed text-ink-500">
                      {entry.body}
                    </p>
                  ) : (
                    <p className="mt-1 text-[13px] text-ink-200">Not yet scoped.</p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="px-4 pb-1">
        {addingCustom ? (
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              const heading = String(fd.get("heading") ?? "").trim();
              if (!heading) return;
              if (entries.some((x) => x.heading.toLowerCase() === heading.toLowerCase())) {
                toast.error(`${heading} is already on this list`);
                return;
              }
              setAddingCustom(false);
              // Created with a placeholder body, because an empty body is how
              // "unwritten" is stored — a blank custom trade would vanish.
              startTransition(async () => {
                const res = await saveTradeScope({ owner, heading, body: "To be scoped." });
                if (!res.ok) {
                  toast.error(res.error);
                  return;
                }
                toast.success(`${heading} added`);
                router.refresh();
              });
            }}
          >
            <Input
              autoFocus
              name="heading"
              className="h-8 max-w-xs text-xs"
              placeholder="Trade name, e.g. Balcony repair"
            />
            <Button type="submit" size="sm" disabled={pending}>
              Add trade
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setAddingCustom(false)}
            >
              Cancel
            </Button>
          </form>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setAddingCustom(true)}>
            + Add a trade
          </Button>
        )}
      </div>
    </div>
  );
}

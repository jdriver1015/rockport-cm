"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, FileUpIcon } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { money } from "@/lib/format";
import {
  parseBudgetWorkbook,
  previewBudgetImport,
  previewBudgetImportForNewProperty,
  applyBudgetOverwrite,
  type BudgetWorkbookParse,
} from "@/lib/actions/budget-import";
import type { BudgetImportPreview } from "@/lib/property-budget-import";

// ---------------------------------------------------------------------------
// One dialog, two entry points.
//
// "overwrite" replaces a live property's budget: it applies the result itself,
// through applyBudgetOverwrite, because the property already exists and this
// is a complete action in its own right.
//
// "prepare" runs during new-property setup, before a property row exists to
// apply anything to. It hands the resolved rows back to the caller instead —
// exactly the shape seedTemplateIds already uses, so createProperty seeds the
// budget in the same non-fatal pass as everything else once the property is
// real.
// ---------------------------------------------------------------------------

type Props =
  | {
      mode: "overwrite";
      propertyId: number;
      chartOfAccountsId: number;
    }
  | {
      mode: "prepare";
      chartOfAccountsId: number;
      onResolved: (rows: { costCodeId: number; uwAmount: number }[], summary: string) => void;
    };

export function BudgetImportDialog(props: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [parsed, setParsed] = useState<BudgetWorkbookParse | null>(null);
  const [preview, setPreview] = useState<BudgetImportPreview | null>(null);
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());

  function toggle(key: string) {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function reset() {
    setParsed(null);
    setPreview(null);
    setOpenSections(new Set());
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    setBusy(true);
    try {
      const result = await parseBudgetWorkbook(fd);
      if (!result.ok) {
        toast.error(result.error);
        reset();
        return;
      }
      setParsed(result);

      const previewResult =
        props.mode === "overwrite"
          ? await previewBudgetImport(props.propertyId, result.rows)
          : await previewBudgetImportForNewProperty(props.chartOfAccountsId, result.rows);
      if (!previewResult.ok) {
        toast.error(previewResult.error);
        return;
      }
      setPreview(previewResult);
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  }

  async function handleConfirm() {
    if (!preview) return;
    setBusy(true);
    try {
      if (props.mode === "overwrite") {
        const result = await applyBudgetOverwrite(props.propertyId, preview.matched, preview.toArchive);
        if (!result.ok) return toast.error(result.error);
        toast.success(
          `Budget updated — ${preview.matched.length} line${preview.matched.length === 1 ? "" : "s"}` +
            (preview.toArchive.length > 0 ? `, ${preview.toArchive.length} archived` : ""),
        );
        setOpen(false);
        reset();
        router.refresh();
      } else {
        const rows = preview.matched.map((m) => ({ costCodeId: m.costCodeId, uwAmount: m.to }));
        const summary = `${rows.length} budget line${rows.length === 1 ? "" : "s"} from the uploaded file`;
        props.onResolved(rows, summary);
        setOpen(false);
        reset();
      }
    } finally {
      setBusy(false);
    }
  }

  const title = props.mode === "overwrite" ? "Upload / replace budget" : "Start from a budget file";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger
        render={
          props.mode === "overwrite" ? (
            <Button size="sm" variant="outline">
              <FileUpIcon className="size-3.5" />
              Upload / Replace
            </Button>
          ) : (
            <button type="button" className={cn(buttonVariants({ size: "sm", variant: "outline" }))}>
              <FileUpIcon className="size-3.5" />
              Upload a budget file
            </button>
          )
        }
      />
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {props.mode === "overwrite"
              ? "Reads an underwriting workbook or a file downloaded from here, and reconciles it against what this property already has."
              : "Reads an underwriting workbook and starts this property's non-interior budget from it. You can still add or edit lines afterward."}
          </DialogDescription>
        </DialogHeader>

        {!parsed ? (
          <div className="space-y-3 py-2">
            <label className="flex cursor-pointer flex-col items-center gap-2 rounded-card border border-dashed border-border px-4 py-8 text-center hover:bg-hover">
              <FileUpIcon className="size-5 text-ink-300" />
              <span className="text-[13px] text-ink-600">
                {busy ? "Reading…" : "Click to choose a spreadsheet"}
              </span>
              <span className="text-[11px] text-muted-foreground">.xlsx, .xls, or .csv</span>
              <input type="file" accept=".xlsx,.xls,.csv" className="hidden" disabled={busy} onChange={handleFile} />
            </label>
            <p className="text-[11px] text-muted-foreground">
              Interior categories are never touched here — they are budgeted per unit under Unit
              Upgrades.
              {props.mode === "overwrite" &&
                " A line already carrying committed cost or posted spend is never removed, whatever the new file says."}
            </p>
          </div>
        ) : !preview ? (
          <p className="py-6 text-center text-[13px] text-muted-foreground">Matching against the chart of accounts…</p>
        ) : (
          <div className="max-h-[60vh] space-y-3 overflow-y-auto py-1">
            <p className="text-[11px] text-muted-foreground">
              Read as{" "}
              <span className="font-medium text-ink-600">{parsed.headers[parsed.mapping.item]}</span> /{" "}
              <span className="font-medium text-ink-600">{parsed.headers[parsed.mapping.amount]}</span>
              {parsed.mapping.code >= 0 && (
                <>
                  {" "}
                  with <span className="font-medium text-ink-600">{parsed.headers[parsed.mapping.code]}</span> matched
                  first
                </>
              )}
              . {parsed.rows.length} row{parsed.rows.length === 1 ? "" : "s"} found.
            </p>

            <Section
              label={preview.matched.length === 0 ? "Nothing to change" : "Will be set"}
              count={preview.matched.length}
              tone="default"
              openKey="matched"
              open={openSections}
              onToggle={toggle}
            >
              {preview.matched.map((m) => (
                <Row key={m.costCodeId}>
                  <span className="truncate">{m.name}</span>
                  <span className="shrink-0 tabular-nums text-ink-500">
                    {m.from === null ? "new" : money(m.from)} → <span className="font-medium text-navy">{money(m.to)}</span>
                  </span>
                </Row>
              ))}
            </Section>

            {preview.unresolved.length > 0 && (
              <Section
                label="Could not match"
                count={preview.unresolved.length}
                tone="alert"
                openKey="unresolved"
                open={openSections}
                onToggle={toggle}
              >
                {preview.unresolved.map((u, i) => (
                  <Row key={i}>
                    <span className="truncate">{u.item}</span>
                    <span className="shrink-0 text-[11px] text-alert">{u.reason}</span>
                  </Row>
                ))}
              </Section>
            )}

            {preview.atRisk.length > 0 && (
              <Section
                label="Kept unchanged — carries real cost"
                count={preview.atRisk.length}
                tone="alert"
                openKey="atRisk"
                open={openSections}
                onToggle={toggle}
              >
                {preview.atRisk.map((a) => (
                  <Row key={a.costCodeId}>
                    <span className="truncate">{a.name}</span>
                    <span className="shrink-0 tabular-nums text-ink-500">
                      {a.committed > 0.005 && `${money(a.committed)} committed`}
                      {a.committed > 0.005 && a.completed > 0.005 && " · "}
                      {a.completed > 0.005 && `${money(a.completed)} posted`}
                    </span>
                  </Row>
                ))}
              </Section>
            )}

            {preview.toArchive.length > 0 && (
              <Section
                label="Not in this file — will be archived"
                count={preview.toArchive.length}
                tone="alert"
                openKey="toArchive"
                open={openSections}
                onToggle={toggle}
              >
                {preview.toArchive.map((a) => (
                  <Row key={a.costCodeId}>
                    <span className="truncate">{a.name}</span>
                    <span className="shrink-0 tabular-nums text-ink-500">{money(a.uwAmount)}</span>
                  </Row>
                ))}
              </Section>
            )}

            {preview.unchangedCount > 0 && (
              <p className="px-0.5 text-[11px] text-muted-foreground">
                {preview.unchangedCount} line{preview.unchangedCount === 1 ? "" : "s"} already match and will not change.
              </p>
            )}

            <div className="flex items-center justify-between border-t border-border pt-2 text-[13px]">
              <span className="text-muted-foreground">Non-interior budget</span>
              <span className="tabular-nums">
                {money(preview.totals.before)} <span className="text-ink-300">→</span>{" "}
                <span className="font-semibold text-navy">{money(preview.totals.after)}</span>
              </span>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between border-t border-border pt-3">
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          {parsed && (
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={reset} disabled={busy}>
                Choose a different file
              </Button>
              <Button
                onClick={handleConfirm}
                disabled={busy || !preview || (preview.matched.length === 0 && preview.toArchive.length === 0)}
              >
                {busy
                  ? "Working…"
                  : props.mode === "overwrite"
                    ? "Apply"
                    : "Use this budget"}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Section({
  label,
  count,
  tone,
  openKey,
  open,
  onToggle,
  children,
}: {
  label: string;
  count: number;
  tone: "default" | "alert";
  openKey: string;
  open: Set<string>;
  onToggle: (key: string) => void;
  children: React.ReactNode;
}) {
  const expanded = open.has(openKey);
  if (count === 0) {
    return (
      <p className="rounded-card border border-border px-3 py-2 text-[12.5px] text-muted-foreground">{label}</p>
    );
  }
  return (
    <div className="overflow-hidden rounded-card border border-border">
      <button
        type="button"
        onClick={() => onToggle(openKey)}
        className="flex w-full items-center gap-2 bg-muted/40 px-3 py-2 text-left hover:bg-muted"
      >
        {expanded ? <ChevronDown className="size-3.5 shrink-0 text-ink-400" /> : <ChevronRight className="size-3.5 shrink-0 text-ink-400" />}
        <span className={cn("flex-1 text-[12.5px] font-medium", tone === "alert" ? "text-alert" : "text-navy")}>
          {label}
        </span>
        <span className="shrink-0 text-[11.5px] text-muted-foreground tabular-nums">{count}</span>
      </button>
      {expanded && <div className="divide-y divide-hairline border-t border-hairline">{children}</div>}
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-3 px-3 py-1.5 text-[12.5px]">{children}</div>;
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { EllipsisIcon, PlusIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  addSpecTable,
  copySpecTablesAction,
  removeSpecTable,
  renameSpecTableAction,
  saveSpecTableGrid,
} from "@/lib/actions/spec-tables";
import {
  SPEC_KIND_LABELS,
  SPEC_PRESETS,
  isFilledRow,
  specRowCount,
  type SpecGrid,
  type SpecKind,
  type SpecTable,
} from "@/lib/spec-tables";
import type { ScopeOwner } from "@/components/trade-scope-section";

export type SpecCopySource = { owner: ScopeOwner; label: string; tableCount: number };

/**
 * The finish specs / fixture kit for one renovation type — the tables a GC orders
 * from.
 *
 * Grids are edited locally and saved per table, not per keystroke: a spec sheet
 * is filled in a burst (a whole paint schedule at once), and a save on every cell
 * would mean a round trip per keypress and a half-entered row hitting the
 * database.
 */
export function SpecTablesSection({
  owner,
  kind,
  tables,
  copySources,
}: {
  owner: ScopeOwner;
  kind: SpecKind;
  tables: SpecTable[];
  copySources: SpecCopySource[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);

  const presets = SPEC_PRESETS.filter((p) => p.kind === kind);
  const usedTitles = new Set(tables.map((t) => t.title));
  const availablePresets = presets.filter((p) => !usedTitles.has(p.title));
  const rowTotal = specRowCount(tables);

  function addPreset(title: string, cols: string[]) {
    startTransition(async () => {
      const res = await addSpecTable({ owner, kind, title, cols });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setAdding(false);
      toast.success(res.created ? `${title} added` : `${title} is already here`);
      router.refresh();
    });
  }

  function copyFrom(source: SpecCopySource) {
    startTransition(async () => {
      const res = await copySpecTablesAction({ to: owner, from: source.owner });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        res.skipped > 0
          ? `${res.copied} table(s) copied — ${res.skipped} left alone because this type already has its own`
          : `${res.copied} table(s) copied from ${source.label}`,
      );
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3 px-4">
        <p className="text-sm text-muted-foreground">
          {tables.length === 0 ? (
            <>Nothing specified yet.</>
          ) : (
            <>
              <span className="font-semibold tabular-nums text-navy">{rowTotal}</span> line
              {rowTotal === 1 ? "" : "s"} across {tables.length} table
              {tables.length === 1 ? "" : "s"}.
            </>
          )}{" "}
          {kind === "finish"
            ? "Colour, product and model — what gets ordered."
            : "Item, vendor and model for each fixture supplied."}
        </p>
        {copySources.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Copy from</span>
            {copySources.map((s) => (
              <Button
                key={`${s.owner.level}:${s.label}`}
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => copyFrom(s)}
              >
                {s.label}
              </Button>
            ))}
          </div>
        )}
      </div>

      {tables.map((table) => (
        <SpecTableEditor key={table.id} owner={owner} table={table} />
      ))}

      <div className="px-4 pb-1">
        {adding ? (
          <div className="space-y-2 rounded-card border border-border p-3">
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-ink-300">
              Add a {SPEC_KIND_LABELS[kind].toLowerCase()} table
            </div>
            {availablePresets.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {availablePresets.map((p) => (
                  <Button
                    key={p.title}
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    title={`Columns: ${p.cols.join(", ")}`}
                    onClick={() => addPreset(p.title, p.cols)}
                  >
                    {p.title}
                  </Button>
                ))}
              </div>
            )}
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                const title = String(fd.get("title") ?? "").trim();
                const cols = String(fd.get("cols") ?? "")
                  .split(",")
                  .map((c) => c.trim())
                  .filter(Boolean);
                if (!title) {
                  toast.error("Name the table");
                  return;
                }
                if (cols.length === 0) {
                  toast.error("List at least one column");
                  return;
                }
                addPreset(title, cols);
              }}
            >
              <Input name="title" className="h-8 w-40 text-xs" placeholder="Table name" />
              <Input
                name="cols"
                className="h-8 min-w-56 flex-1 text-xs"
                placeholder="Columns, comma separated"
              />
              <Button type="submit" size="sm" disabled={pending}>
                Add
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </form>
          </div>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
            + Add a table
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * One grid. Held in local state while editing so tabbing across a row is a
 * normal table-entry experience, and committed as a whole.
 */
function SpecTableEditor({ owner, table }: { owner: ScopeOwner; table: SpecTable }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<SpecGrid>(table.grid);
  const [renaming, setRenaming] = useState(false);

  // A refresh brings a new grid; adopt it unless there are unsaved edits to lose.
  const [baseline, setBaseline] = useState(table.grid);
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  if (table.grid !== baseline && !dirty) {
    setBaseline(table.grid);
    setDraft(table.grid);
  }

  function setCell(r: number, c: number, value: string) {
    setDraft((g) => ({
      cols: g.cols,
      rows: g.rows.map((row, ri) => (ri === r ? row.map((cell, ci) => (ci === c ? value : cell)) : row)),
    }));
  }

  function addRow() {
    setDraft((g) => ({ cols: g.cols, rows: [...g.rows, g.cols.map(() => "")] }));
  }

  function removeRow(r: number) {
    setDraft((g) => ({ cols: g.cols, rows: g.rows.filter((_, ri) => ri !== r) }));
  }

  function addColumn(name: string) {
    setDraft((g) => ({ cols: [...g.cols, name], rows: g.rows.map((row) => [...row, ""]) }));
  }

  function removeColumn(c: number) {
    setDraft((g) => ({
      cols: g.cols.filter((_, ci) => ci !== c),
      rows: g.rows.map((row) => row.filter((_, ci) => ci !== c)),
    }));
  }

  function save() {
    startTransition(async () => {
      const res = await saveSpecTableGrid({
        owner,
        id: table.id,
        grid: draft,
        expectedVersion: table.version,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const kept = draft.rows.filter(isFilledRow).length;
      toast.success(`${table.title} saved — ${kept} line${kept === 1 ? "" : "s"}`);
      // Clear the dirty flag against what was just sent, so the refresh below is
      // free to replace the draft with the server's version — which has blank
      // rows stripped. Without this the editor would keep showing them, and keep
      // claiming unsaved changes, until the page was reloaded.
      setBaseline(draft);
      router.refresh();
    });
  }

  function remove() {
    startTransition(async () => {
      const res = await removeSpecTable({ owner, id: table.id });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`${table.title} removed`);
      router.refresh();
    });
  }

  return (
    <div className="border-y border-border">
      <div className="flex flex-wrap items-center justify-between gap-2 bg-muted/30 px-4 py-2">
        {renaming ? (
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const title = String(new FormData(e.currentTarget).get("title") ?? "").trim();
              if (!title) return;
              setRenaming(false);
              startTransition(async () => {
                const res = await renameSpecTableAction({ owner, id: table.id, title });
                if (!res.ok) {
                  toast.error(res.error);
                  return;
                }
                router.refresh();
              });
            }}
          >
            <Input
              autoFocus
              name="title"
              defaultValue={table.title}
              className="h-7 w-44 text-xs"
            />
            <Button type="submit" size="sm" disabled={pending}>
              Rename
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setRenaming(false)}>
              Cancel
            </Button>
          </form>
        ) : (
          <span className="text-[13.5px] font-medium text-navy">{table.title}</span>
        )}

        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">
            {dirty ? "Unsaved changes" : "Saved"}
          </span>
          <Button size="sm" disabled={pending || !dirty} onClick={save}>
            Save
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger disabled={pending} render={<Button variant="ghost" size="icon-sm" />}>
              <EllipsisIcon />
              <span className="sr-only">{table.title} actions</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setRenaming(true)}>Rename table</DropdownMenuItem>
              <DropdownMenuItem variant="destructive" disabled={pending} onClick={remove}>
                Remove table
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {draft.cols.map((col, c) => (
                <th
                  key={`${col}-${c}`}
                  className="border-b border-border px-2 py-1.5 text-left text-[10.5px] font-semibold uppercase tracking-[0.09em] text-ink-300"
                >
                  <span className="flex items-center gap-1">
                    {col}
                    {draft.cols.length > 1 && (
                      <button
                        type="button"
                        title={`Remove the ${col} column`}
                        disabled={pending}
                        onClick={() => removeColumn(c)}
                        className="text-ink-100 hover:text-alert"
                      >
                        <XIcon className="size-3" />
                      </button>
                    )}
                  </span>
                </th>
              ))}
              <th className="w-8 border-b border-border" />
            </tr>
          </thead>
          <tbody>
            {draft.rows.length === 0 ? (
              <tr>
                <td
                  colSpan={draft.cols.length + 1}
                  className="px-2 py-6 text-center text-sm text-muted-foreground"
                >
                  No lines yet — add one and fill in the columns.
                </td>
              </tr>
            ) : (
              draft.rows.map((row, r) => (
                <tr key={r} className={cn("border-b border-hairline", pending && "opacity-60")}>
                  {row.map((cell, c) => (
                    <td key={c} className="p-0">
                      <input
                        value={cell}
                        disabled={pending}
                        aria-label={`${draft.cols[c]} row ${r + 1}`}
                        onChange={(e) => setCell(r, c, e.target.value)}
                        className="w-full border-0 bg-transparent px-2 py-1.5 text-[13px] outline-none focus:bg-hover focus-visible:ring-1 focus-visible:ring-ring/50"
                      />
                    </td>
                  ))}
                  <td className="px-1 text-right">
                    <button
                      type="button"
                      title="Remove this line"
                      disabled={pending}
                      onClick={() => removeRow(r)}
                      className="text-ink-100 hover:text-alert"
                    >
                      <XIcon className="size-3.5" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-4 py-2">
        <Button size="sm" variant="ghost" disabled={pending} onClick={addRow}>
          <PlusIcon className="size-3.5" />
          Row
        </Button>
        <form
          className="flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const name = String(new FormData(form).get("col") ?? "").trim();
            if (!name) return;
            if (draft.cols.includes(name)) {
              toast.error(`There is already a ${name} column`);
              return;
            }
            addColumn(name);
            form.reset();
          }}
        >
          <Input name="col" className="h-7 w-36 text-xs" placeholder="New column" />
          <Button type="submit" size="sm" variant="ghost" disabled={pending}>
            <PlusIcon className="size-3.5" />
            Column
          </Button>
        </form>
        {dirty && (
          <span className="text-[11px] text-muted-foreground">
            Rows, columns and cells save together.
          </span>
        )}
      </div>
    </div>
  );
}

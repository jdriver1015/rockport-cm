"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { confirmImportColumns } from "@/lib/actions/gl";
import type { ColumnOverride } from "@/lib/gl-import";

type Sheet = { name: string; rows: string[][]; totalRows: number };

/** Canonical GL fields the user maps columns onto. */
const FIELDS: { key: keyof Omit<ColumnOverride, "sheetName" | "headerRow">; label: string }[] = [
  { key: "date", label: "Date" },
  { key: "vendor", label: "Vendor / payee" },
  { key: "description", label: "Description" },
  { key: "amount", label: "Amount" },
  { key: "debit", label: "Debit" },
  { key: "credit", label: "Credit" },
  { key: "invoice", label: "Invoice / reference" },
  { key: "check", label: "Check #" },
  { key: "account", label: "GL account" },
  { key: "unit", label: "Unit" },
];

/**
 * Manual column-mapping step for a GL export whose layout wasn't auto-detected.
 * The user picks the header row and assigns each field to a column; the mapping
 * is remembered so the same format auto-recognizes next time.
 */
export function GlColumnMapper({
  propertyId,
  batchId,
  sheets,
}: {
  propertyId: number;
  batchId: number;
  sheets: Sheet[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [sheetName, setSheetName] = useState(sheets[0]?.name ?? "");
  const [headerRow, setHeaderRow] = useState(0);
  const [cols, setCols] = useState<Record<string, number | undefined>>({});

  const sheet = useMemo(() => sheets.find((s) => s.name === sheetName) ?? sheets[0], [sheets, sheetName]);
  const colCount = useMemo(
    () => sheet?.rows.reduce((m, r) => Math.max(m, r.length), 0) ?? 0,
    [sheet],
  );
  const headerCells = sheet?.rows[headerRow] ?? [];

  function setField(key: string, value: string) {
    setCols((prev) => ({ ...prev, [key]: value === "" ? undefined : Number(value) }));
  }

  function columnLabel(i: number) {
    const h = (headerCells[i] ?? "").trim();
    return h ? `${i + 1}. ${h}` : `Column ${i + 1}`;
  }

  function confirm() {
    if (!sheet) return;
    const mapping: ColumnOverride = { sheetName: sheet.name, headerRow };
    for (const { key } of FIELDS) {
      const v = cols[key];
      if (v !== undefined) (mapping as Record<string, unknown>)[key] = v;
    }
    startTransition(async () => {
      const res = await confirmImportColumns(batchId, mapping);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Columns mapped");
      router.push(`/properties/${propertyId}/gl/${batchId}`);
      router.refresh();
    });
  }

  if (!sheet) return <p className="text-sm text-muted-foreground">No sheet data to map.</p>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        We couldn&apos;t recognize this file&apos;s layout. Pick the header row, then tell us which
        column holds each field. Map an <span className="font-medium">Amount</span> column, or{" "}
        <span className="font-medium">Debit</span>/<span className="font-medium">Credit</span> to net
        them.
      </p>

      {sheets.length > 1 && (
        <label className="flex items-center gap-2 text-sm">
          Sheet:
          <select
            value={sheetName}
            onChange={(e) => {
              setSheetName(e.target.value);
              setHeaderRow(0);
              setCols({});
            }}
            className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
          >
            {sheets.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name} ({s.totalRows} rows)
              </option>
            ))}
          </select>
        </label>
      )}

      {/* Field → column assignment */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {FIELDS.map(({ key, label }) => (
          <label key={key} className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">{label}</span>
            <select
              value={cols[key] ?? ""}
              onChange={(e) => setField(key, e.target.value)}
              className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
            >
              <option value="">— none —</option>
              {Array.from({ length: colCount }, (_, i) => (
                <option key={i} value={i}>
                  {columnLabel(i)}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>

      {/* Preview grid — click a row to mark it as the header */}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-xs">
          <tbody>
            {sheet.rows.map((row, r) => (
              <tr
                key={r}
                onClick={() => setHeaderRow(r)}
                className={`cursor-pointer border-b last:border-0 ${
                  r === headerRow ? "bg-gold/15 font-medium" : "hover:bg-muted/40"
                }`}
              >
                <td className="whitespace-nowrap px-2 py-1 text-muted-foreground">
                  {r === headerRow ? "header ▸" : r + 1}
                </td>
                {Array.from({ length: colCount }, (_, c) => (
                  <td key={c} className="max-w-[160px] truncate px-2 py-1">
                    {row[c] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end">
        <Button disabled={pending} onClick={confirm}>
          {pending ? "Mapping…" : "Map columns & continue"}
        </Button>
      </div>
    </div>
  );
}

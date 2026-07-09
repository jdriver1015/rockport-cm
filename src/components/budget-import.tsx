"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { moneyExact } from "@/lib/format";

type PreviewRow = {
  costCodeId: number;
  code: string;
  name: string;
  uwAmount: number;
  perUnitAmount?: number;
  plannedUnits?: number;
  merged?: boolean;
  existingAmount: number | null;
};

type Preview = {
  rows: PreviewRow[];
  unmatched: { sheet: string; row: number; text: string; amount: number | null }[];
  total: number;
  fileName: string;
};

export function BudgetImport({ projectId }: { projectId: number }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);

  async function handleFile(file: File) {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/projects/${projectId}/budget/parse`, {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Could not parse file");
        return;
      }
      setPreview(data);
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!preview) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/budget/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: preview.rows.map((r) => ({
            costCodeId: r.costCodeId,
            uwAmount: r.uwAmount,
            perUnitAmount: r.perUnitAmount,
            plannedUnits: r.plannedUnits,
          })),
          note: `Imported from ${preview.fileName}`,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Import failed");
        return;
      }
      toast.success(`Budget imported — ${data.count} cost codes updated`);
      setPreview(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (preview) {
    const changed = preview.rows.filter(
      (r) => r.existingAmount === null || Math.abs(r.existingAmount - r.uwAmount) > 0.005,
    ).length;
    return (
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-medium text-[#1b355d]">
                {preview.fileName} — {preview.rows.length} cost codes recognized,{" "}
                {moneyExact(preview.total)} total
              </p>
              <p className="text-sm text-muted-foreground">
                {changed} line{changed === 1 ? "" : "s"} will be added or updated
                {preview.unmatched.length > 0 &&
                  ` · ${preview.unmatched.length} rows not recognized (listed below)`}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setPreview(null)} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={commit} disabled={busy}>
                {busy ? "Importing…" : "Confirm import"}
              </Button>
            </div>
          </div>

          <div className="max-h-96 overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cost code</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Current</TableHead>
                  <TableHead className="text-right">Imported</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.rows.map((r) => (
                  <TableRow key={r.costCodeId}>
                    <TableCell className="font-mono text-xs">{r.code}</TableCell>
                    <TableCell>
                      {r.name}
                      {r.merged && (
                        <span className="ml-1 text-xs text-muted-foreground">(summed)</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {r.existingAmount === null ? "new" : moneyExact(r.existingAmount)}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {moneyExact(r.uwAmount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {preview.unmatched.length > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
              <p className="mb-1 font-medium text-amber-900">Rows not recognized</p>
              <ul className="max-h-32 space-y-0.5 overflow-auto text-amber-800">
                {preview.unmatched.map((u, i) => (
                  <li key={i} className="font-mono text-xs">
                    {u.sheet} row {u.row}: {u.text || "(blank)"}
                    {u.amount !== null ? ` — ${moneyExact(u.amount)}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div
      className={cn(
        "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 text-center transition-colors",
        dragging ? "border-[#1457a5] bg-[#e8edf2]" : "border-muted-foreground/25 hover:bg-muted/50",
      )}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (file) void handleFile(file);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xlsm,.xls,.csv"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          e.target.value = "";
        }}
      />
      <p className="font-medium text-[#1b355d]">
        {busy ? "Reading file…" : "Drop a budget Excel file here"}
      </p>
      <p className="text-sm text-muted-foreground">
        or click to browse — needs a Cost Code column (####-####) or cost-code names with amounts
      </p>
    </div>
  );
}
